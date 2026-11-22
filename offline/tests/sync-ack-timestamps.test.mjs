import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual syncEvent implementation using PostgREST-style timestamp
// responses (UTC offset rather than JavaScript's equivalent Z notation).
const runtime=await fs.readFile(new URL('../runtime.js',import.meta.url),'utf8');
const start=runtime.indexOf('  // PostgreSQL can return the same timestamptz');
const end=runtime.indexOf('\n  async function doSync() {',start);
assert(start>=0 && end>start,'Sync timestamp helper and syncEvent not found');
const implementation=runtime.slice(start,end);
const user='user-123';
const RATING='kg_chart_user_ratings',COMPLETION='kg_chart_topic_completions';
const SESSION='kg_chart_quiz_sessions',ANSWER='kg_chart_quiz_answers';
const UTC='2026-11-20T13:00:00.000Z';
const OFFSET='2026-11-20T13:00:00.000+00:00';
const LATER='2026-11-21T13:00:00.000Z';
const EARLIER='2026-11-19T13:00:00.000Z';
const formatStamp=value=>value==null?value:new Date(value).toISOString().replace('Z','+00:00');

function makeClient(initial={},afterWrite=null) {
  const rows=new Map(Object.entries(initial).map(([table,row])=>[table,row?{...row}:null]));
  const writes=[];
  const attempts=[];
  const client={from(table) {
    const filters=[];
    return {
      select() {return this;},
      eq(key,value) {filters.push([key,value]);return this;},
      async maybeSingle() {
        const row=rows.get(table)||null;
        if(!row || !filters.every(([key,value])=>row[key]===value))
          return {data:null,error:null};
        const formatted={...row};
        for(const key of ['last_reviewed_at','completed_at','updated_at','created_at','answered_at'])
          if(formatted[key]!=null)formatted[key]=formatStamp(formatted[key]);
        return {data:formatted,error:null};
      },
      async insert(row) {
        attempts.push({table,row:{...row}});
        if(rows.get(table)?.id===row.id) return {data:null,error:{code:'23505',message:'duplicate key'}};
        writes.push({table,row:{...row}});
        rows.set(table,{...row});
        return {data:null,error:null};
      },
      async upsert(row) {
        writes.push({table,row:{...row}});
        rows.set(table,{...rows.get(table),...row});
        if(afterWrite)afterWrite(table,rows);
        return {data:null,error:null};
      }
    };
  }};
  const context={owner:user,accountGuard:()=>()=>{},live:client,
    TABLES:{ratings:RATING,completions:COMPLETION,levels:'kg_chart_user_levels',
      prefs:'kg_chart_user_prefs',sessions:SESSION,answers:ANSWER},
    PRIMARY:{
      [RATING]:['user_id','vocabulary_id','language_code'],
      [COMPLETION]:['user_id','language_code','topic_id'],
      [SESSION]:['id'],[ANSWER]:['id']
    }};
  const syncEvent=vm.runInNewContext(implementation+'\nsyncEvent',context);
  return {syncEvent,writes,rows,attempts};
}

function rating(fields={},baseUpdatedAt=null) {
  return {ownerId:user,table:RATING,kind:'upsert',baseUpdatedAt,filters:[],
    row:{user_id:user,vocabulary_id:'pig',language_code:'my',
      rating:5,last_reviewed_at:UTC,updated_at:UTC,...fields}};
}
function completion(fields={}) {
  return {ownerId:user,table:COMPLETION,kind:'upsert',filters:[],
    row:{user_id:user,language_code:'my',topic_id:'food',
      completed_at:UTC,...fields}};
}

test('accepts exact rating acknowledgment when PostgREST reformats Z to +00:00',async()=>{
  const h=makeClient();const e=rating();
  await h.syncEvent(e);
  assert.equal(h.writes.length,1);
  assert.equal(h.rows.get(RATING).rating,5);
  assert.equal(e.row.last_reviewed_at,UTC,'outbox event is not changed');
});
test('retry of a previously uploaded rating is acknowledged without a second write',async()=>{
  const e=rating();
  const h=makeClient({[RATING]:{...e.row,last_reviewed_at:OFFSET,updated_at:OFFSET}});
  await h.syncEvent(e);
  assert.equal(h.writes.length,0);
});
test('same baseline instant in an offset does not create a false rating conflict',async()=>{
  const e=rating({rating:4,last_reviewed_at:LATER,updated_at:LATER},UTC);
  const h=makeClient({[RATING]:{...e.row,rating:3,last_reviewed_at:UTC,updated_at:OFFSET}});
  await h.syncEvent(e);
  assert.equal(h.rows.get(RATING).rating,4);
  assert.equal(h.writes.length,1);
});
test('a real concurrent rating change remains blocked with a conflict code',async()=>{
  const e=rating({rating:4,last_reviewed_at:LATER,updated_at:LATER},EARLIER);
  const h=makeClient({[RATING]:{...e.row,rating:3,last_reviewed_at:UTC,updated_at:OFFSET}});
  await assert.rejects(h.syncEvent(e),err=>err.code==='KG_RATING_CONFLICT');
  assert.equal(h.rows.get(RATING).rating,3);
  assert.equal(h.writes.length,0);
});
test('accepts completion timestamp acknowledgment when the server changes only offset notation',async()=>{
  const h=makeClient();
  await h.syncEvent(completion());
  assert.equal(h.writes.length,1);
});
test('newer remote completion is preserved',async()=>{
  const e=completion({completed_at:EARLIER});
  const h=makeClient({[COMPLETION]:{...e.row,completed_at:OFFSET}});
  await h.syncEvent(e);
  assert.equal(h.writes.length,0);
  assert.equal(h.rows.get(COMPLETION).completed_at,OFFSET);
});
test('a genuine read-back rating mismatch still blocks acknowledgment',async()=>{
  const h=makeClient({},(table,rows)=>{
    if(table===RATING) rows.get(RATING).rating=2;
  });
  await assert.rejects(h.syncEvent(rating()),/kg_chart_user_ratings\.rating/);
  assert.equal(h.writes.length,1);
});

function session(fields={}) {
  return {ownerId:user,table:SESSION,kind:'insert',filters:[],
    row:{id:'session-one',user_id:user,language_code:'my',topic_id:'food',
      quiz_type:'native_to_image',total_questions:18,correct_answers:18,
      created_at:UTC,completed_at:UTC,...fields}};
}
function answer(fields={}) {
  return {ownerId:user,table:ANSWER,kind:'insert',filters:[],
    row:{id:'answer-one',session_id:'session-one',vocabulary_id:'pig',
      user_answer_vocabulary_id:'pig',is_correct:true,response_time_ms:500,
      created_at:UTC,answered_at:UTC,...fields}};
}

test('duplicate quiz session retry acknowledges equivalent created/completed timestamps',async()=>{
  const event=session();
  const remote={...event.row,created_at:OFFSET,completed_at:OFFSET};
  const h=makeClient({[SESSION]:remote});
  await h.syncEvent(event);
  assert.equal(h.attempts.length,1,'The duplicate insert was actually retried');
  assert.equal(h.writes.length,0,'Retry does not generate another session');
  assert.equal(h.rows.get(SESSION).created_at,OFFSET,'Remote record is unchanged');
  assert.equal(event.row.created_at,UTC,'Queued record remains unmodified');
});

test('duplicate quiz answer retry acknowledges equivalent created/answered timestamps',async()=>{
  const event=answer();
  const h=makeClient({[ANSWER]:{...event.row,created_at:OFFSET,answered_at:OFFSET}});
  await h.syncEvent(event);
  assert.equal(h.attempts.length,1);
  assert.equal(h.writes.length,0,'Retry does not duplicate an answer');
  assert.equal(event.row.answered_at,UTC,'Queued answer was not rewritten');
});

test('duplicate quiz session with genuinely different time remains unacknowledged',async()=>{
  const event=session();
  const saved={...event.row,created_at:LATER,completed_at:OFFSET};
  const h=makeClient({[SESSION]:saved});
  await assert.rejects(h.syncEvent(event),/kg_chart_quiz_sessions\.created_at/);
  assert.equal(h.writes.length,0);
  assert.equal(h.rows.get(SESSION).created_at,LATER,'Conflicting server history is protected');
});

test('duplicate quiz answer with a different result remains unacknowledged',async()=>{
  const event=answer();
  const saved={...event.row,created_at:OFFSET,answered_at:OFFSET,is_correct:false};
  const h=makeClient({[ANSWER]:saved});
  await assert.rejects(h.syncEvent(event),/kg_chart_quiz_answers\.is_correct/);
  assert.equal(h.writes.length,0);
  assert.equal(h.rows.get(ANSWER).is_correct,false,'Conflicting answer is protected');
});

test('duplicate quiz answer with a different answered_at remains unacknowledged',async()=>{
  const event=answer();
  const saved={...event.row,created_at:OFFSET,answered_at:EARLIER};
  const h=makeClient({[ANSWER]:saved});
  await assert.rejects(h.syncEvent(event),/kg_chart_quiz_answers\.answered_at/);
  assert.equal(h.writes.length,0);
});

test('new quiz inserts still work normally and are acknowledged',async()=>{
  for(const event of [session(),answer()]){
    const h=makeClient();
    await h.syncEvent(event);
    assert.equal(h.attempts.length,1);
    assert.equal(h.writes.length,1);
    assert.deepEqual(h.rows.get(event.table),event.row);
  }
});
