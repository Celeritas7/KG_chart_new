import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the production syncEvent implementation, including the read-back
// acknowledgment. Simulate PostgreSQL's "level <= unlocked" constraint and
// the default unlocked = 1 on a legacy partial upsert.
const runtime=await fs.readFile(new URL('../runtime.js',import.meta.url),'utf8');
const start=runtime.indexOf('  // PostgreSQL can return the same timestamptz');
const end=runtime.indexOf('\n  async function doSync() {',start);
assert(start>=0 && end>start,'Could not locate the production sync implementation');
const code=runtime.slice(start,end);

function makeSync(remoteInitial=null) {
  let remote=remoteInitial?{...remoteInitial}:null;
  const posted=[];
  const table='kg_chart_user_levels';
  const client={
    from(name) {
      assert.equal(name,table);
      const filters=[];
      return {
        select() {return this;},
        eq(k,v) {filters.push([k,v]);return this;},
        async maybeSingle() {
          const found=remote && filters.every(([k,v])=>remote[k]===v);
          return {data:found?{...remote}:null,error:null};
        },
        async upsert(value) {
          // PostgreSQL default for a column omitted by the old app's upsert.
          const row={...value,unlocked:value.unlocked??1};
          posted.push({...row});
          if(row.level>row.unlocked)
            return {data:null,error:{message:'new row violates check constraint kg_chart_user_levels_check'}};
          remote=row;
          return {data:null,error:null};
        }
      };
    }
  };
  const ctx={owner:'user-a',accountGuard:()=>()=>{},live:client,
    TABLES:{levels:table,ratings:'kg_chart_user_ratings',
      completions:'kg_chart_topic_completions',prefs:'kg_chart_user_prefs',sessions:'kg_chart_quiz_sessions'},
    PRIMARY:{[table]:['email','language_code']}};
  const sync=vm.runInNewContext(code+'\nsyncEvent',ctx);
  return {sync,posted,getRemote:()=>remote};
}

const email='learner@example.org';
function event(row) {return {ownerId:'user-a',table:'kg_chart_user_levels',
  kind:'upsert',row:{email,language_code:'my',...row},filters:[]};}

test('queued old level change respects the server unlocked level',async()=>{
  const state=makeSync({email,language_code:'my',level:1,unlocked:3,
    updated_at:'2026-11-01T00:00:00Z'});
  const queued=event({level:2,updated_at:'2026-11-19T00:00:00Z'});
  await state.sync(queued);
  assert.equal(state.getRemote().level,2);
  assert.equal(state.getRemote().unlocked,3);
  assert.equal(queued.row.unlocked,undefined,'Original outbox event is preserved');
});

test('new learner level is valid even when the old queued event omitted unlocked',async()=>{
  const state=makeSync();
  await state.sync(event({level:2,updated_at:'2026-11-19T00:00:00Z'}));
  assert.equal(state.getRemote().unlocked,2);
});

test('stale queued unlocked cannot downgrade server progress',async()=>{
  const state=makeSync({email,language_code:'my',level:2,unlocked:4});
  await state.sync(event({level:3,unlocked:2}));
  assert.equal(state.getRemote().level,3);
  assert.equal(state.getRemote().unlocked,4);
});

test('invalid level remains an explicit error instead of silently discarding progress',async()=>{
  const state=makeSync({email,language_code:'my',level:1,unlocked:3});
  await assert.rejects(state.sync(event({level:5})),/Invalid saved difficulty level/);
  assert.equal(state.getRemote().level,1);
  assert.equal(state.posted.length,0);
});

test('online difficulty changes write unlocked alongside level',async()=>{
  const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html,/from\(TABLES\.userLevels\)\.upsert\(\{\s*email,\s*language_code:\s*languageCode,\s*level,\s*unlocked:\s*Math\.max\(level,\s*unlocked\)/);
});
