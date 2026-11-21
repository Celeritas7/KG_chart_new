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
const UTC='2026-11-20T13:00:00.000Z';
const OFFSET='2026-11-20T13:00:00.000+00:00';
const LATER='2026-11-21T13:00:00.000Z';
const EARLIER='2026-11-19T13:00:00.000Z';
const formatStamp=value=>value==null?value:new Date(value).toISOString().replace('Z','+00:00');

function makeClient(initial={},afterWrite=null) {
  const rows=new Map(Object.entries(initial).map(([table,row])=>[table,row?{...row}:null]));
  const writes=[];
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
        for(const key of ['last_reviewed_at','completed_at','updated_at'])
          if(formatted[key]!=null)formatted[key]=formatStamp(formatted[key]);
        return {data:formatted,error:null};
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
      prefs:'kg_chart_user_prefs',sessions:'kg_chart_quiz_sessions'},
    PRIMARY:{
      [RATING]:['user_id','vocabulary_id','language_code'],
      [COMPLETION]:['user_id','language_code','topic_id']
    }};
  const syncEvent=vm.runInNewContext(implementation+'\nsyncEvent',context);
  return {syncEvent,writes,rows};
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
