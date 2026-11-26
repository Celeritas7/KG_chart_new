// F2D3D2 candidate only. Not imported by the deployed Edge entry point.
// All dependencies are injected, including verified Auth and both RPC clients.
import { checkWav, base64ToBytes, parseAzure, referenceFor, LOCALES, MAX_TEXT, MAX_WAV }
  from '../../supabase/functions/kg-pronounce/core.ts';

const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const err = (status,reason) => ({status,body:{ok:false,reason}});
const validScore = x => x !== null && Number.isInteger(x) && x>=0 && x<=100;
const resultOK = x => x && validScore(x.score) &&
  ['accuracy','fluency','completeness'].every(k=>x[k]===null || validScore(x[k])) &&
  Array.isArray(x.words) && x.words.length<=1000 &&
  x.words.every(w=>w && typeof w.w==='string' && typeof w.error==='string' &&
    (w.accuracy===null || validScore(w.accuracy)));
const resultKeys = ['score','accuracy','fluency','completeness','words'];
function sameResult(a,b) {
  if (!resultOK(a)||!resultOK(b)) return false;
  return resultKeys.slice(0,4).every(k=>a[k]===b[k]) && a.words.length===b.words.length &&
    a.words.every((w,i)=>['w','accuracy','error'].every(k=>w[k]===b.words[i][k]));
}
const sqlFailure = e => e?.code==='42501' ? err(403,'not_allowed')
  : ['40001','23505'].includes(e?.code) ? err(409,'reconcile')
  : e?.code==='22023' ? err(400,'bad_request') : err(503,'unconfirmed');
function ackOK(a,id) {
  return a && a.request_id===id && Number.isSafeInteger(a.used) && a.used>=0 &&
    Number.isSafeInteger(a.reserved) && a.reserved>=0 &&
    Number.isSafeInteger(a.limit) && a.limit>0 &&
    ['start','pending','expired','saved','failed','no_speech','limit'].includes(a.status) &&
    (a.status==='saved' ? resultOK(a.result) : a.result===null);
}
function response(a) {
  if (a.status==='saved') return {status:200,body:{ok:true,saved:true,request_id:a.request_id,
    ...a.result,used:a.used,limit:a.limit}};
  if (a.status==='no_speech') return err(200,'no_speech');
  if (a.status==='limit') return err(429,'limit');
  if (a.status==='pending') return err(409,'pending');
  if (a.status==='expired') return err(409,'expired');
  if (a.status==='failed') return err(502,'assessment_failed');
  return err(503,'unconfirmed');
}
async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    b=>b.toString(16).padStart(2,'0')).join('');
}
export function makePronunciationCandidate({authenticate,begin,finish,assess}) {
  return async (authHeader,body) => {
    let user;
    try { user=await authenticate(authHeader); } catch { return err(401,'auth'); }
    if (!uuid(user?.id)) return err(401,'auth');
    if (!body || typeof body!=='object' || Array.isArray(body) ||
        Object.keys(body).some(k=>!['request_id','expected_revision','lang','text','audio',
          'vocabulary_id','sentence_id','source'].includes(k)) ||
        !uuid(body.request_id) || !Number.isSafeInteger(body.expected_revision) || body.expected_revision<1 ||
        !Object.hasOwn(LOCALES,body.lang) || typeof body.text!=='string' ||
        typeof body.audio!=='string' || body.audio.length>Math.ceil(MAX_WAV/3)*4+4) return err(400,'bad_request');
    const id=body.request_id.toLowerCase(), text=body.text.normalize('NFC').trim();
    const vocab=body.vocabulary_id??null, sentence=body.sentence_id??null;
    if (!text || text.length>MAX_TEXT ||
      !((body.source==='word' && uuid(vocab) && sentence===null) ||
        (body.source==='speak_lines' && uuid(sentence) && vocab===null))) return err(400,'bad_request');
    let wav;
    try { wav=base64ToBytes(body.audio); } catch { return err(400,'bad_request'); }
    if (checkWav(wav)) return err(400,'bad_request');
    let started;
    try {
      started=await begin(authHeader,{p_expected_revision:body.expected_revision,p_request_id:id,
        p_lang:body.lang,p_text:text,p_vocabulary_id:vocab,p_sentence_id:sentence,
        p_source:body.source,p_audio_sha256:await digest(wav)});
    } catch(e) { return sqlFailure(e); }
    if (!ackOK(started,id)) return err(503,'unconfirmed');
    if (started.status!=='start') return response(started);

    let state='failed',result=null;
    try {
      const parsed=parseAzure(await assess({wav,locale:LOCALES[body.lang],text:referenceFor(body.lang,text)}));
      if (parsed.status==='Success' && resultOK(parsed)) {
        state='saved';
        result=Object.fromEntries(resultKeys.map(k=>[k,parsed[k]]));
      } else if (['NoMatch','InitialSilenceTimeout','BabbleTimeout'].includes(parsed.status)) state='no_speech';
    } catch { /* known provider failure; release only on confirmed finalization */ }
    let completed;
    try { completed=await finish({p_owner:user.id,p_expected_revision:body.expected_revision,
      p_request_id:id,p_state:state,p_result:result}); }
    catch(e) { return sqlFailure(e); }
    if (!ackOK(completed,id) || completed.status!==state ||
      (state==='saved' && !sameResult(completed.result,result))) return err(503,'unconfirmed');
    return response(completed);
  };
}
