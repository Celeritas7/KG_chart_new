/**
 * KG Chart U3B3B1 — offline, READ-ONLY private-media reference classifier.
 *
 * This DOES NOT query Supabase, read credentials, copy/remove Storage objects,
 * generate signed URLs, print learner emails or publish privacy policies.
 * Never commit a real input JSON export: it may contain private lesson text.
 *
 * Input: a manually acquired local JSON snapshot of relevant KG Chart
 * reference tables + optional Storage object names, not binary media.
 * Output: aggregate counts only; no private names, texts or hashes.
 *
 * Public audio is keyed by FNV1a32(norm(text)) in audio/<lang>/<voice>/<hash>.mp3.
 * The hash has no ownership semantics. One clip may be referenced by public
 * and private content, or distinct texts can collide. Never delete/move
 * public assets based only on this audit.
 */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const norm = t => String(t??'').normalize('NFC').trim().split(/\s+/u).filter(Boolean).join(' ');
export function fnv1a8(value) {
  let h=0x811c9dc5;
  for (const b of new TextEncoder().encode(norm(value))) {
    h^=b;h=Math.imul(h,0x01000193)>>>0;
  }
  return h.toString(16).padStart(8,'0');
}
const array = x=>Array.isArray(x)?x:[];
const topicKey=(lang,topic)=>String(lang||'')+'|'+String(topic||'');
const category=values=>{
  const kinds=new Set(values.map(x=>x.privacy));
  const texts=new Set(values.map(x=>x.normalized));
  if(texts.size>1) return 'collision_review';
  if(kinds.has('unknown'))return 'unknown_review';
  if(kinds.has('private')&&kinds.has('public'))return 'shared';
  if(kinds.has('private'))return 'private_exclusive_candidate';
  if(kinds.has('public'))return 'public_only';
  return 'unknown_review';
};
const emptyCounts=()=>({
  private_exclusive_candidate:0, shared:0,public_only:0,
  collision_review:0,unknown_review:0,
});
const validLang=x=>/^[a-z]{2,3}$/.test(String(x||''));

export function auditPrivateMedia(snapshot,{hash=fnv1a8}={}) {
  const privateTopics=new Set(),privateGroups=new Set();
  for (const rule of array(snapshot.privateRules)) {
    if(!rule||typeof rule!=='object')continue;
    const lang=String(rule.language_code||'');
    if(!validLang(lang))continue;
    if(typeof rule.topic_id==='string'&&rule.topic_id)
      privateTopics.add(topicKey(lang,rule.topic_id));
    for(const group of array(rule.sentence_groups))if(typeof group==='string'&&group)
      privateGroups.add(topicKey(lang,group));
  }

  const wordMap=new Map(array(snapshot.words).map(v=>[v.id,v]));
  const audio=new Map(),pictures=new Map();
  const errors={incomplete_audio_refs:0,external_picture_refs:0,invalid_picture_refs:0};
  function includeAudio(lang,text,privacy,source) {
    if(!validLang(lang)||typeof text!=='string'||!norm(text)){
      errors.incomplete_audio_refs++;return;
    }
    const normalized=norm(text),digest=hash(normalized);
    if(!/^[0-9a-f]{8}$/.test(digest))throw Error('Invalid audio hash');
    const k=lang+'/'+digest;
    if(!audio.has(k))audio.set(k,[]);
    audio.get(k).push({normalized,privacy,source});
  }
  function includePicture(topic,name,privacy){
    if(typeof name!=='string'||!name||name.startsWith('emoji:')||
       name.startsWith('linear-gradient')||name.startsWith('#'))return;
    if(/^https?:\/\//.test(name)){errors.external_picture_refs++;return;}
    // Do not automatically classify path traversal, absolute or hidden files.
    if(!topic||name.includes('..')||name.startsWith('/')||name.includes('\\')){
      errors.invalid_picture_refs++;return;
    }
    const key=String(topic)+'/'+name;
    if(!pictures.has(key))pictures.set(key,[]);
    pictures.get(key).push({normalized:key,privacy});
  }

  for(const item of array(snapshot.wordTranslations)) {
    const v=wordMap.get(item.vocabulary_id);
    const privacy=!v?'unknown':
      privateTopics.has(topicKey(item.language_code,v.topic_id))?'private':'public';
    includeAudio(item.language_code,item.native_text,privacy,'word');
  }
  for(const item of array(snapshot.topicTranslations)) {
    const privacy=privateTopics.has(topicKey(item.language_code,item.topic_id))?'private':'public';
    includeAudio(item.language_code,item.question_native,privacy,'topic_question');
  }
  for(const item of array(snapshot.sentences)) {
    const privacy=privateGroups.has(topicKey(item.language_code,item.group_name))?'private':'public';
    includeAudio(item.language_code,item.native_text,privacy,'sentence');
  }
  for(const item of array(snapshot.colourPhrases)) {
    // A colour-phrase audio may reuse public/private vocabulary or contain
    // otherwise private content. Unless an exact topic relationship is known,
    // do not deem it safe to migrate automatically.
    includeAudio(item.language_code,item.native_text,'unknown','colour_phrase');
    if(item.picture)errors.external_picture_refs++;
  }
  // Pictures use the parent topic's folder, independent of the translation
  // language. Require the full set of translations to detect shared use.
  const langsByWord=new Map();
  for(const row of array(snapshot.wordTranslations)) {
    if(!langsByWord.has(row.vocabulary_id))langsByWord.set(row.vocabulary_id,new Set());
    langsByWord.get(row.vocabulary_id).add(row.language_code);
  }
  for(const item of array(snapshot.words)){
    const langs=[...(langsByWord.get(item.id)||[])];
    if(!langs.length){
      includePicture(item.topic_id,item.image_filename,'unknown');continue;
    }
    for(const lang of langs){
      includePicture(item.topic_id,item.image_filename,
        privateTopics.has(topicKey(lang,item.topic_id))?'private':'public');
    }
  }

  const tally=map=>{
    const groups=emptyCounts();
    for(const refs of map.values())groups[category(refs)]++;
    return groups;
  };
  const audioCounts=tally(audio),pictureCounts=tally(pictures);
  const observed={audio:{...emptyCounts(),unreferenced:0},pictures:{...emptyCounts(),unreferenced:0},other:0};
  for(const item of array(snapshot.mediaObjects)) {
    if(typeof item.name!=='string') {observed.other++;continue;}
    const match=/^audio\/([a-z]{2,3})\/([mf])\/([a-f0-9]{8})\.mp3$/.exec(item.name);
    if(match) {
      const refs=audio.get(match[1]+'/'+match[3]);
      observed.audio[refs?category(refs):'unreferenced']++;continue;
    }
    if(item.name.startsWith('audio/')){observed.other++;continue;}
    const refs=pictures.get(item.name);
    observed.pictures[refs?category(refs):'unreferenced']++;
  }
  const privateCandidate=audioCounts.private_exclusive_candidate;
  const shared=audioCounts.shared;
  return {
    contract:1,read_only:true,privacy_enforced:false,
    referenced:{audio:audioCounts,pictures:pictureCounts},
    observed,scanned_references:audio.size,
    candidate_private_audio_hashes:privateCandidate,
    shared_audio_hashes:shared,
    review_required:errors,
    warning:'Public bucket objects and old cached URLs remain publicly accessible; these counts are not a migration or permission check.',
  };
}
const path=fileURLToPath(import.meta.url);
if(process.argv[1]&&resolve(process.argv[1])===path) {
  const ix=process.argv.indexOf('--input');
  if(ix<0||!process.argv[ix+1]) {
    process.stdout.write('Usage: node tools/audit-kg-private-media.mjs --input <local-snapshot.json>\nRead-only; emits aggregate counts only. Never commit actual private export data.\n');
    process.exit(ix>=0?2:0);
  }
  try{
    const contents=JSON.parse(await readFile(process.argv[ix+1],'utf8'));
    process.stdout.write(JSON.stringify(auditPrivateMedia(contents),null,2)+'\n');
  }catch(e){process.stderr.write('Could not classify private media snapshot: '+e.message+'\n');process.exitCode=1;}
}
