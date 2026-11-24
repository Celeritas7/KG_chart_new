// KG Chart U3B3B2: staged protected-media URL signer.
// This is NOT deployed. The private bucket and verified registry records
// do not exist in production until a separate backup/approval-gated rollout.
// No path, bucket, content hash, username or email comes from the caller.
// Only a signed-in, allowlisted learner with resource-level permission
// may obtain a short-lived URL for an independently verified PRIVATE object.

export const PRIVATE_BUCKET='kg-chart-private-media';
export const SIGNED_SECONDS=30;
export const MIME_EXTENSIONS: Record<string,string>={
  'audio/mpeg':'.mp3',
  'image/jpeg':'.jpg',
  'image/png':'.png',
  'image/webp':'.webp',
  'image/gif':'.gif',
};
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
type Config = {
  env:(name:string)=>string|undefined;
  userClient:(authHeader:string)=>any;
  adminClient:()=>any;
};
function json(status:number, body:unknown, origin:string|null, allowedOrigins:Set<string>){
  const headers:Record<string,string>={
    'Content-Type':'application/json',
    'Cache-Control':'no-store, private',
    'Referrer-Policy':'no-referrer',
    'Vary':'Origin',
  };
  if(origin && allowedOrigins.has(origin)){
    headers['Access-Control-Allow-Origin']=origin;
    headers['Access-Control-Allow-Methods']='POST, OPTIONS';
    headers['Access-Control-Allow-Headers']='authorization, apikey, x-client-info, content-type';
  }
  return new Response(JSON.stringify(body),{status,headers});
}
const fail=(status:number,reason:string,origin:string|null,allow:Set<string>)=>
  json(status,{ok:false,reason},origin,allow);

export function makeHandler(deps:Config) {
  return async (req:Request):Promise<Response>=>{
    const origin=req.headers.get('Origin');
    const allow=new Set((deps.env('KG_PRIVATE_MEDIA_ALLOWED_ORIGINS')||'')
      .split(',').map(x=>x.trim()).filter(x=>/^https:\/\/[^/]+$/i.test(x)));
    if(!allow.size)return fail(503,'configuration_unavailable',origin,allow);
    if(origin&&!allow.has(origin))return fail(403,'origin_not_allowed',origin,allow);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{
      'Cache-Control':'no-store','Vary':'Origin',
      ...(origin?{'Access-Control-Allow-Origin':origin}:{}),
      'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',
    }});
    if(req.method!=='POST')return fail(405,'method_not_allowed',origin,allow);

    const auth=req.headers.get('Authorization')||'';
    if(!/^Bearer \S+$/.test(auth))return fail(401,'authentication_required',origin,allow);
    // Parse only a single opaque asset_id. Other body fields are ignored;
    // a browser-supplied object path, bucket, mime type or user ID is never
    // used for authorization or to construct a Storage request.
    let body:any;
    try {body=await req.json();}catch(_){return fail(400,'invalid_json',origin,allow);}
    const id=body?.asset_id;
    if(typeof id!=='string'||!UUID.test(id))
      return fail(400,'invalid_asset_id',origin,allow);
    const assetId=id.toLowerCase();

    const userDb=deps.userClient(auth);
    const {data:authenticated,error:authError}=await userDb.auth.getUser(auth.slice(7));
    if(authError||!authenticated?.user?.id)
      return fail(401,'authentication_required',origin,allow);
    const approved=await userDb.rpc('kg_chart_is_allowed');
    if(approved.error||approved.data!==true)
      return fail(403,'not_allowed',origin,allow);
    // This caller-scoped SQL checks the ACTUAL resource mapping and topic,
    // private lesson membership, language and feature selection.
    const check=await userDb.rpc('kg_chart_u3b3b2_can_media',{p_asset_id:assetId});
    if(check.error)return fail(503,'permissions_unavailable',origin,allow);
    if(check.data!==true)return fail(403,'not_allowed',origin,allow);

    // Only now is the service-role client created. It never receives a user
    // path and NEVER serves the existing public vocabulary-assets bucket.
    const admin=deps.adminClient();
    const {data:asset,error:recordError}=await admin
      .from('kg_chart_private_media_assets')
      .select('asset_id,mime_type,state,classification,verified_at,sha256_hex,byte_size')
      .eq('asset_id',assetId).maybeSingle();
    if(recordError)return fail(503,'media_registry_unavailable',origin,allow);
    if(!asset||asset.asset_id?.toLowerCase()!==assetId||
       asset.state!=='verified'||asset.classification!=='private_exclusive'||
       !asset.verified_at||!Number.isSafeInteger(Number(asset.byte_size))||
       Number(asset.byte_size)<=0||!(/^[0-9a-f]{64}$/.test(String(asset.sha256_hex||''))))
      return fail(404,'media_unavailable',origin,allow);
    const ext=MIME_EXTENSIONS[asset.mime_type];
    if(!ext)return fail(404,'media_unavailable',origin,allow);
    const path='protected/'+assetId+ext;
    const {data:signed,error:signErr}=await admin.storage
      .from(PRIVATE_BUCKET).createSignedUrl(path,SIGNED_SECONDS);
    if(signErr||!signed?.signedUrl)
      return fail(503,'media_unavailable',origin,allow);

    // Validate that the storage provider actually returned a URL on THIS
    // Supabase project and bucket. Never forward untrusted alternate hosts.
    const supabaseUrl=deps.env('SUPABASE_URL');
    let target:URL,base:URL;
    try {
      base=new URL(String(supabaseUrl));
      target=new URL(String(signed.signedUrl),base);
    }catch(_){return fail(503,'media_unavailable',origin,allow);}
    const expected='/storage/v1/object/sign/'+PRIVATE_BUCKET+'/'+path;
    if(base.protocol!=='https:'||target.protocol!=='https:'||
       target.origin!==base.origin||target.pathname!==expected||
       !target.searchParams.has('token'))
      return fail(503,'media_unavailable',origin,allow);

    return json(200,{
      ok:true,asset_id:assetId,url:target.href,
      expires_in:SIGNED_SECONDS,content_type:asset.mime_type,
    },origin,allow);
  };
}
