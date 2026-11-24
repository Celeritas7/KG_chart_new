// U3B3B2 — preview-only protected-media client adapter for later U3C/U3D.
// NOT wired into the current online/offline players. They still play public
// media unchanged. This adapter has NO automatic fallback to public URLs.
// It never supplies an arbitrary bucket/path or user identity to the server.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const TYPES=new Set(['word_audio','topic_audio','sentence_audio','colour_audio','word_image']);

export async function resolveProtectedMedia({
  supabase,sourceType,sourceId=null,topicId=null,language,voice=null,projectUrl
}) {
  if(!supabase||!TYPES.has(sourceType)||typeof language!=='string'||
     !/^[a-z]{2,3}$/.test(language)||
     (sourceType==='topic_audio'
       ? typeof topicId!=='string'||!topicId||sourceId!==null
       : typeof sourceId!=='string'||!UUID.test(sourceId)||topicId!==null)||
     (sourceType==='word_image' ? voice!==null : !['m','f'].includes(voice))) {
    throw Error('Invalid protected media resource request');
  }
  const {data:assetId,error:lookError}=await supabase.rpc(
    'kg_chart_u3b3b2_my_media_asset',{
      p_source_type:sourceType,p_source_id:sourceId,p_topic_id:topicId,
      p_language:language,p_voice:voice,
    });
  if(lookError)throw Error('Protected media permissions unavailable');
  // A NULL is NOT permission to use a public URL for a private resource.
  if(assetId==null)return null;
  if(typeof assetId!=='string'||!UUID.test(assetId))
    throw Error('Invalid protected asset reference');

  const {data,error}=await supabase.functions.invoke('kg-private-media',{
    body:{asset_id:assetId},
  });
  if(error||data?.ok!==true||data.asset_id?.toLowerCase()!==assetId.toLowerCase())
    throw Error('Protected media delivery denied or unavailable');
  if(!Number.isInteger(data.expires_in)||data.expires_in>30||
     data.expires_in<=0)
    throw Error('Protected media expiry invalid');

  let base,url;
  try{base=new URL(projectUrl);url=new URL(data.url);}catch(_){
    throw Error('Invalid protected media URL');
  }
  const path='/storage/v1/object/sign/kg-chart-private-media/protected/';
  if(base.protocol!=='https:'||url.protocol!=='https:'||
     url.origin!==base.origin||!url.pathname.startsWith(path)||
     !url.searchParams.has('token'))
    throw Error('Protected media URL was not issued by this project');

  return {url:url.href,expiresIn:data.expires_in,contentType:data.content_type};
}
