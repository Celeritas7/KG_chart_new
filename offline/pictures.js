/* Content-addressed picture bytes shared by language packs for ONE account.
 * Legacy pack entries remain readable. No cache or pack is deleted here.
 */
(function(root){
  const PREFIX='kg-offline-pictures-v1-';
  const pointer='X-KG-Picture-Hash';
  const hash=async response=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const key=sha=>'https://kg-local.invalid/pictures/'+sha;
  async function open(name,owner,writeShared=true){
    if(!/^[\da-f-]{36}$/i.test(owner||'') || !name.startsWith('kg-offline-pack-'+owner+'-')) throw Error('Picture cache account mismatch');
    const pack=await caches.open(name);
    return {
      sharedWrites:writeShared,
      async match(url){
        const entry=await pack.match(url);if(!entry)return undefined;
        const sha=entry.headers.get(pointer);if(!sha)return entry;
        if(!/^[a-f0-9]{64}$/.test(sha))throw Error('Invalid saved picture reference');
        const response=await (await caches.open(PREFIX+owner)).match(key(sha));
        if(!response)return undefined;
        // Per-URL revision/placeholder headers belong to the pack, not the blob.
        const headers=new Headers(entry.headers);headers.delete(pointer);
        return new Response(await response.blob(),{status:200,headers});
      },
      async put(url,response){
        const sha=response.headers.get('X-KG-SHA256');
        if(!writeShared || !response.headers.get('Content-Type')?.startsWith('image/') || !/^[a-f0-9]{64}$/.test(sha||''))return pack.put(url,response);
        if(await hash(response.clone())!==sha)throw Error('Picture hash mismatch');
        const shared=await caches.open(PREFIX+owner);
        const existing=await shared.match(key(sha));
        if(!existing || await hash(existing.clone())!==sha)await shared.put(key(sha),response.clone());
        const headers=new Headers(response.headers);headers.set(pointer,sha);
        // Empty pointer record, never a second copy of the image bytes.
        await pack.put(url,new Response(null,{status:200,headers}));
      }
    };
  }
  root.KGSharedPictures={open,PREFIX};
})(typeof self==='undefined'?window:self);
