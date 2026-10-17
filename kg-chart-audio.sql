-- ============================================================
-- KG Chart - Phase 9: audio preferences on the account (voice + mute)
-- Run in the Supabase SQL editor AFTER kg-chart-phase8b.sql. Safe to re-run.
-- Without this table the app still works; prefs are then kept on the device only.
-- ============================================================

create table if not exists public.kg_chart_user_prefs (
  user_id uuid primary key,
  audio_voice text not null default 'f' check (audio_voice in ('m', 'f')),
  audio_muted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.kg_chart_user_prefs enable row level security;

drop policy if exists prefs_read on public.kg_chart_user_prefs;
create policy prefs_read on public.kg_chart_user_prefs for select to authenticated
  using (user_id = auth.uid());
drop policy if exists prefs_insert on public.kg_chart_user_prefs;
create policy prefs_insert on public.kg_chart_user_prefs for insert to authenticated
  with check (user_id = auth.uid() and public.kg_chart_is_allowed());
drop policy if exists prefs_update on public.kg_chart_user_prefs;
create policy prefs_update on public.kg_chart_user_prefs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.kg_chart_is_allowed());
