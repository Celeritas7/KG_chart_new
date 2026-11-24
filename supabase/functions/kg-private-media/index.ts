// U3B3B2 staged KG Chart private media Edge Function. DO NOT DEPLOY YET.
// The schema and private bucket do not exist in production. This source
// does not create/move/delete any Storage object or invalidate public media.
// Preflight may be unauthenticated (verify_jwt off at gateway), but core.ts
// independently verifies EVERY POST bearer with auth.getUser + KG allowlist
// + scoped private-resource RPC before using service_role to issue a URL.
// Requires KG_PRIVATE_MEDIA_ALLOWED_ORIGINS explicit HTTPS origin allowlist.
import {createClient} from 'npm:@supabase/supabase-js@2.99.3';
import {makeHandler} from './core.ts';

const env=(name:string)=>Deno.env.get(name);
const project=env('SUPABASE_URL')!;

Deno.serve(makeHandler({
  env,
  userClient:(authHeader:string)=>createClient(
    project,env('SUPABASE_ANON_KEY')!,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{Authorization:authHeader}},
    }
  ),
  adminClient:()=>createClient(
    project,env('SUPABASE_SERVICE_ROLE_KEY')!,{
      auth:{persistSession:false,autoRefreshToken:false},
    }
  ),
}));
