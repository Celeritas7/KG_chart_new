# KG Chart — Admin panel patch + RLS handoff

## 1. `kg-chart-admin-patched.html`
Drop-in replacement for `kg-chart-admin.html` (same folder, same relative links). All Supabase logic is untouched. What changed:

- **Sidebar** now matches the design system: dark jade shell (`--sidebar-shell`, per-theme token), light rounded nav card, translucent header/footer dividers. Works in all 4 themes.
- **Flags page stat tiles**: Open flags / Vocabulary / Missing translations at the top (warn color when non-zero).
- **Accessibility**: flag rows expand via a real `<button aria-expanded>`; nav items are keyboard-operable (Tab + Enter/Space); `:focus-visible` rings on buttons, tabs, nav, theme swatches.

## 2. `kg-chart-rls.sql`
Run once in the Supabase SQL editor (Dashboard → SQL). Idempotent. It:

- Creates `kg_chart_admins` (seeded with your admin user id) + a `kg_chart_is_admin()` helper, so admin rights live server-side and adding an admin is one SQL insert — no code change.
- Content tables (`languages`, `topics`, `topic_translations`, `vocabulary`, `vocabulary_translations`): public read, **admin-only insert/update/delete**.
- `kg_chart_flags`: public read; signed-in learners can insert (`status='open'` only); only admin can resolve/dismiss/delete.
- `kg_chart_user_ratings`, `kg_chart_quiz_sessions`, `kg_chart_quiz_answers`: each user reads/writes only their own rows; admin can read all (Quiz Stats page keeps working).
- Storage bucket `vocabulary-assets`: admin-only upload/update/delete (public read unchanged).

## Notes
- The anon key in the HTML is designed to be public **once RLS is on** — after running the SQL it grants nothing beyond these policies. The client-side `ADMIN_USER_ID` check is now just UX; enforcement is server-side.
- `upload_images.js` (Node) — if it uses the service-role key it bypasses RLS and keeps working; never ship that key to the browser.
- Test after applying: sign in as a non-admin and try editing a language — it should fail with a policy error.
