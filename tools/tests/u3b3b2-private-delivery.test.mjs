import test from 'node:test';
import assert from 'node:assert/strict';
import {makeHandler,PRIVATE_BUCKET,SIGNED_SECONDS} from '../../supabase/functions/kg-private-media/core.ts';
import {resolveProtectedMedia} from '../../js/kg-private-media-client.mjs';

const ID='10000000-0000-4000-8000-000000000001';
const SOURCE='20000000-0000-4000-8000-000000000002';
const PROJECT='https://synthetic.supabase.co';
const ORIGIN='https://kg-chart-offline.pages.dev';
const TOKEN='fictional-signed-token';
function sourceUrl(path,host=PROJECT) {
  return host+'/storage/v1/object/sign/'+PRIVATE_BUCKET+'/'+path+'?token='+TOKEN;
}
function mocks({
  approved=true,auth=true,can=true,scopeError=false,
  status='verified',classification='private_exclusive',
  providerUrl=null,providerError=null,
  allowedOrigins=ORIGIN,
}={}){
  const calls={user:0,allow:0,can:0,admin:0,lookup:0,sign:0,paths:[]};
  const client={
    auth:{async getUser(){calls.user++;return auth?{data:{user:{id:SOURCE}},error:null}:
      {data:{user:null},error:{message:'not signed in'}}}},
    async rpc(name,args){
      if(name==='kg_chart_is_allowed'){calls.allow++;return {data:approved,error:null};}
      if(name==='kg_chart_u3b3b2_can_media'){
        calls.can++;assert.equal(args.p_asset_id,ID);
        return scopeError?{error:{message:'function absent'},data:null}:
          {data:can,error:null};
      }
      throw Error('Unexpected caller RPC '+name);
    }
  };
  const privateRow={
    asset_id:ID,mime_type:'audio/mpeg',state:status,classification,
    verified_at:'2026-11-25T00:00:00Z',
    sha256_hex:'a'.repeat(64),byte_size:1234
  };
  const admin={
    from(table){
      assert.equal(table,'kg_chart_private_media_assets');calls.lookup++;
      return {select(){return this},eq(k,v){assert.equal(k,'asset_id');assert.equal(v,ID);return this},
        async maybeSingle(){return {data:privateRow,error:null}}};
    },
    storage:{from(bucket){
      assert.equal(bucket,PRIVATE_BUCKET);
      return {async createSignedUrl(path,ttl){
        calls.sign++;calls.paths.push(path);
        assert.equal(ttl,SIGNED_SECONDS);
        return {data:{signedUrl:providerUrl||sourceUrl(path)},error:providerError};
      }};
    }},
  };
  const deps={
    env(k){return ({
      KG_PRIVATE_MEDIA_ALLOWED_ORIGINS:allowedOrigins,
      SUPABASE_URL:PROJECT,
    })[k];},
    userClient(header){assert.equal(header,'Bearer fake-session');return client;},
    adminClient(){calls.admin++;return admin;},
  };
  return {handler:makeHandler(deps),calls};
}
async function request(handler,body={asset_id:ID},opts={}){
  return handler(new Request('https://synthetic.supabase.co/functions/v1/kg-private-media',{
    method:opts.method||'POST',
    headers:{
      Origin:opts.origin??ORIGIN,'Content-Type':'application/json',
      ...(opts.noAuth?{}:{Authorization:'Bearer fake-session'}),
    },
    ...(opts.method==='OPTIONS'?{}:{body:JSON.stringify(body)})
  }));
}
test('Approved preflight succeeds without creating a service-role client',async()=>{
  const {handler,calls}=mocks();
  const response=await request(handler,{}, {method:'OPTIONS'});
  assert.equal(response.status,204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),ORIGIN);
  assert.equal(calls.admin,0);
});
test('Unknown CORS origin and missing origin configuration fail closed',async()=>{
  const m=mocks();
  const denied=await request(m.handler,{}, {origin:'https://untrusted.invalid'});
  assert.equal(denied.status,403);assert.equal(m.calls.user,0);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
  assert.equal((await request(mocks({allowedOrigins:''}).handler)).status,503);
});
test('Unsigned and invalid callers cannot get a token',async()=>{
  const missing=mocks(),res=await request(missing.handler,{}, {noAuth:true});
  assert.equal(res.status,401);assert.equal(missing.calls.admin,0);
  const bad=mocks({auth:false});
  assert.equal((await request(bad.handler)).status,401);
  assert.equal(bad.calls.admin,0);
});
test('Denied allowlist, restricted asset and missing RLS function never reach service role',async()=>{
  for(const c of [{approved:false},{can:false},{scopeError:true}]){
    const m=mocks(c);const response=await request(m.handler);
    assert.equal(response.status,c.scopeError?503:403);
    assert.equal(m.calls.admin,0);
    assert.equal(m.calls.sign,0);
  }
});
test('Successful grant signs only a fixed private UUID path for 30 seconds',async()=>{
  const m=mocks();const response=await request(m.handler,{
    asset_id:ID, bucket:'vocabulary-assets',path:'../public/secret.mp3',
    user_id:'forged-user',expires_in:999999,
  });
  assert.equal(response.status,200);
  assert.match(response.headers.get('Cache-Control'),/no-store/);
  const data=await response.json();
  assert.equal(data.ok,true);
  assert.equal(data.expires_in,30);
  assert.equal(data.url,sourceUrl('protected/'+ID+'.mp3'));
  assert.equal(m.calls.admin,1);
  assert.deepEqual(m.calls.paths,['protected/'+ID+'.mp3']);
});
test('Unverified, shared, wrong MIME or invalid provider responses are blocked',async()=>{
  for(const opts of [
    {status:'staged'},{classification:'shared'},
    {providerError:{message:'missing file'}},
    {providerUrl:'https://attacker.invalid/abc?token=foo'},
    {providerUrl:PROJECT+'/storage/v1/object/sign/vocabulary-assets/protected/'+ID+'.mp3?token=x'},
    {providerUrl:PROJECT+'/storage/v1/object/sign/'+PRIVATE_BUCKET+'/protected/'+ID+'.mp3'},
  ]){
    const m=mocks(opts);
    const response=await request(m.handler);
    assert.ok([404,503].includes(response.status));
    assert.equal((await response.json()).ok,false);
  }
});
test('Malformed UUID and unsupported HTTP method are rejected before lookup',async()=>{
  const m=mocks();
  assert.equal((await request(m.handler,{asset_id:'../../my/f/secret.mp3'})).status,400);
  assert.equal((await request(m.handler,{asset_id:ID},{method:'PUT'})).status,405);
  assert.equal(m.calls.user,0);assert.equal(m.calls.admin,0);
});
test('Client requires a scoped resource lookup and never falls back to public URLs',async()=>{
  const events=[];
  const client={
    async rpc(name,args){events.push({name,args});return {
      data:ID,error:null
    }},
    functions:{async invoke(name,args){events.push({name,args});return {
      data:{ok:true,asset_id:ID,url:sourceUrl('protected/'+ID+'.mp3'),expires_in:30,
        content_type:'audio/mpeg'},error:null
    }}},
  };
  const found=await resolveProtectedMedia({
    supabase:client,sourceType:'word_audio',sourceId:SOURCE,
    language:'my',voice:'f',projectUrl:PROJECT,
  });
  assert.equal(found.url,sourceUrl('protected/'+ID+'.mp3'));
  assert.equal(events[0].name,'kg_chart_u3b3b2_my_media_asset');
  assert.equal(events[1].name,'kg-private-media');
  assert.deepEqual(events[1].args,{body:{asset_id:ID}});
  const absent=await resolveProtectedMedia({
    supabase:{rpc:async()=>({data:null,error:null})},
    sourceType:'word_audio',sourceId:SOURCE,language:'my',voice:'f',projectUrl:PROJECT,
  });
  assert.equal(absent,null);
});
test('Client refuses hostile returned signed URLs and guessed object paths',async()=>{
  const client={
    rpc:async()=>({data:ID,error:null}),
    functions:{invoke:async()=>({
      data:{ok:true,asset_id:ID,url:'https://evil.invalid/abc?token=x',
        expires_in:30,content_type:'audio/mpeg'},error:null
    })}
  };
  await assert.rejects(resolveProtectedMedia({
    supabase:client,sourceType:'word_audio',sourceId:SOURCE,
    language:'my',voice:'m',projectUrl:PROJECT,
  }),/not issued by this project/);
  await assert.rejects(resolveProtectedMedia({
    supabase:client,sourceType:'word_audio',sourceId:'../../../',
    language:'my',voice:'m',projectUrl:PROJECT,
  }),/Invalid protected media resource request/);
});
