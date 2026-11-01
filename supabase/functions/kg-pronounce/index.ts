// KG Chart 🎙️ pronunciation check: Supabase Edge Function. The logic is in core.ts (tested outside Supabase);
// this file only wires in the real Supabase clients and Deno's environment.
// Secrets (Supabase → Edge Functions → Secrets): AZURE_SPEECH_KEY, AZURE_SPEECH_REGION.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Deployed with verify_jwt off: the browser's CORS preflight has no token; core.ts checks the login itself.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeHandler } from './core.ts';

const env = (k: string) => Deno.env.get(k);
const url = env('SUPABASE_URL')!;

Deno.serve(makeHandler({
  env,
  fetch,
  userClient: (authHeader: string) => createClient(url, env('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  }),
  adminClient: () => createClient(url, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }),
}));
