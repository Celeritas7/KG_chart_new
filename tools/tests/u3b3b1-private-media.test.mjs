import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPrivateMedia,fnv1a8,norm} from '../audit-kg-private-media.mjs';

const base={
  privateRules:[{language_code:'my',topic_id:'friends_names',sentence_groups:['personal_line']}],
  words:[
    {id:'a',topic_id:'friends_names',image_filename:'friend.jpg'},
    {id:'b',topic_id:'food',image_filename:'food.jpg'},
    {id:'c',topic_id:'food',image_filename:'shared.jpg'},
  ],
  wordTranslations:[
    {vocabulary_id:'a',language_code:'my',native_text:'Private word'},
    {vocabulary_id:'b',language_code:'my',native_text:'Public word'},
    {vocabulary_id:'c',language_code:'my',native_text:'Private word'},
    {vocabulary_id:'b',language_code:'ja',native_text:'Public Japanese'},
  ],
  topicTranslations:[
    {topic_id:'friends_names',language_code:'my',question_native:'Private prompt'},
    {topic_id:'food',language_code:'my',question_native:'Public prompt'},
  ],
  sentences:[
    {language_code:'my',group_name:'personal_line',native_text:'Private phrase'},
    {language_code:'my',group_name:'food',native_text:'Public phrase'},
  ],
  colourPhrases:[],
};
const audio=(text,voice='m',lang='my')=>'audio/'+lang+'/'+voice+'/'+fnv1a8(text)+'.mp3';

test('JS FNV1a hashing matches generator normalization with Unicode/NFC',()=>{
  assert.equal(norm('  A   B  '),'A B');
  assert.equal(fnv1a8('hello'),'4f9f2cab');
  assert.equal(fnv1a8('  é '),fnv1a8('e\u0301'));
  assert.equal(fnv1a8('Private word').length,8);
});
test('private-only audio, shared text and ordinary audio are distinct classes',()=>{
  const model={...base,mediaObjects:[
    {name:audio('Private phrase')},{name:audio('Private word')},
    {name:audio('Public word')},{name:'audio/my/clips.json'},
    {name:'unknown/image.jpg'},
  ]};
  const report=auditPrivateMedia(model);
  assert.equal(report.read_only,true);
  assert.equal(report.privacy_enforced,false);
  assert.equal(report.referenced.audio.private_exclusive_candidate,2); // phrase + prompt
  assert.equal(report.referenced.audio.shared,1); // same normalized word referenced both ways
  assert.equal(report.referenced.audio.public_only,4); // public my word/prompt/phrase and ja word
  assert.equal(report.observed.audio.private_exclusive_candidate,1);
  assert.equal(report.observed.audio.shared,1);
  assert.equal(report.observed.audio.public_only,1);
  assert.equal(report.observed.other,1);
  assert.equal(report.observed.pictures.unreferenced,1);
});
test('private picture reference is a candidate, never automatically removed',()=>{
 const r=auditPrivateMedia(base);
 assert.equal(r.referenced.pictures.private_exclusive_candidate,1);
 assert.equal(r.referenced.pictures.public_only,2);
 assert.equal(r.observed.audio.unreferenced,0);
 assert.equal(Object.hasOwn(r,'raw_audio_texts'),false);
});
test('one hash for different source texts is collision-review even when private',()=>{
 const s={...base,mediaObjects:[{name:'audio/my/m/abcdef01.mp3'}]};
 const r=auditPrivateMedia(s,{hash:()=> 'abcdef01'});
 assert.equal(r.referenced.audio.collision_review,1); // many distinct Myanmar texts collide
 assert.equal(r.observed.audio.collision_review,1);
 assert.equal(r.candidate_private_audio_hashes,0);
});
test('unmatched storage objects are NOT guessed private or deleted',()=>{
 const r=auditPrivateMedia({...base,mediaObjects:[
   {name:'audio/my/f/deadbeef.mp3'},{name:'misc/family.png'},
 ]});
 assert.equal(r.observed.audio.unreferenced,1);
 assert.equal(r.observed.pictures.unreferenced,1);
 assert.equal(r.privacy_enforced,false);
});
test('missing references and external media are marked review-required',()=>{
 const s={...base,
  wordTranslations:[...base.wordTranslations,{vocabulary_id:'missing',language_code:'my',native_text:'orphan'}],
  words:[...base.words,{id:'e',topic_id:'friends_names',image_filename:'https://external.invalid/photo.png'}],
  colourPhrases:[{language_code:'my',native_text:'uncertain phrase',picture:'emoji:🎨'}]
 };
 const r=auditPrivateMedia(s);
 assert.equal(r.referenced.audio.unknown_review,2); // unknown word ref + colour phrase
 assert.equal(r.review_required.external_picture_refs,2);
 assert.equal(r.referenced.pictures.private_exclusive_candidate,1);
});
test('report JSON never contains source private text or learner emails',()=>{
 const s={...base,privateRules:[
 {language_code:'my',topic_id:'friends_names',emails:['someone@example.invalid'],sentence_groups:[]}],
 };
 const body=JSON.stringify(auditPrivateMedia(s));
 assert.doesNotMatch(body,/Private word|Private prompt|someone@example.invalid|friend.jpg/);
 assert.match(body,/publicly accessible/);
});
