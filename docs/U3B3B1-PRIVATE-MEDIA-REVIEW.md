# KG Chart U3B3B1 — Legacy Private RPC Closure + Media Reference Audit

**Starting main:** c9ba7a46c31a0c5f2cdbe8a10fe4c3e2f605700b (U3B3A / PR #80 merged).
**Scope:** first independently reviewable increment of **U3B3B**. This is **NOT** a private-media rollout. U3B3B2 protected media delivery remains.
**Production:** Proposed SQL/manual audit only. No Supabase SQL applied, no bucket or audio/image moved, no public URL invalidated, no deployment, no online/offline app modified, no user permission published.
**Dependency:** U1, U2, U3A, U3B1, U3B2, U3B3A are merged **source proposals**, but those database schemas are still absent from Technical Supabase. Apply only in a separate backup/approval-gated installation sequence.

## Verified source-based findings (read-only)

- KG Chart stores audio under public Storage prefix audio/<language>/<m|f>/<FNV-1a32-of-normalized-UTF8-text>.mp3, with audio/<language>/clips.json listing hashes. The audio generator reads *all* translated words, topic questions, sentences and colour phrases before uploading; the in-app resolver hashes the requested text without resource ID.
- Existing image paths use a public topic-folder path, and online image download caches expect a stable public URL. The offline app uses canonical public audio/image URLs and preserves shared account-scoped downloaded bytes.
- Technical Supabase vocabulary-assets is a PUBLIC bucket; public CDN media is accessible by URL and old copies may remain on devices/CDN even after a later permission change.
- Current private_lessons has **2 Burmese topic rules**, for **sweet_talk** and **friends_names**. The rules include a sentence group and user email allowlists, which are deliberately not reproduced in the PR.
- Read-only aggregate query: **15 Burmese private-topic vocabulary translations**, with **2 texts also present in vocabulary outside those private topics**. Thus a private text's existing public audio hash might be shared by other lessons. No blind moves or deletion are safe.
- The U3B2 helper logic, although valid for future restricted profiles, returns early for LEGACY users on some quiz-answer and pronunciation paths. That bypasses U3B3A private source-table RLS when a SECURITY DEFINER RPC reads rows or the Edge Function uses service-role score writes. Existing directly owned historical records must not be deleted.

These details were obtained from the actual merged repository and read-only Technical Supabase queries on the current project. They are **not** proof that media is confidential or that all privileged functions are secure.

## Change 1 — SQL fixes for older legacy paths

Proposed manual SQL: [sql/kg-chart-u3b3b1-legacy-private-write-rpc.sql](../sql/kg-chart-u3b3b1-legacy-private-write-rpc.sql).

Add **7 RESTRICTIVE write policies** layered on top of the previous U3B2 rules. They apply U3B3A's private-topic/word/sentence-group checks to:
- Quiz session INSERT with explicit topic; a topic-less ("All") session remains possible but cannot accept a private question.
- Quiz answer INSERT, checking verified session owner and the real referenced word/sentence. Caller-provided answer text is never accepted as authorization.
- Rating INSERT/UPDATE and topic completion INSERT/UPDATE.
- Flag INSERT, including word, sentence and colour-phrase resources.

Override existing privileged, auth-owned RPCs **without changing their signatures**:
- kg_chart_my_answers: return only the requesting user's non-private authorized answer records, even when old DB quiz rows exist for a private lesson. Those historic rows are preserved.
- kg_chart_u3b2_can_pronounce: no more legacy early shortcut. Check real word/sentence ID, same-language translation, private permissions, expected native text and valid request source **before** an Azure call or service-role write can be authorized. Admins and users explicitly permitted for a private topic still work.

The helpers are fixed-search-path, caller-scoped booleans, with no arbitrary email parameter, dynamic SQL or newly exposed anonymous EXECUTE. All U3B2 and U3B3A legacy/server authorization, role and private rules remain prerequisites. The SQL is idempotent; no user records, role grants, existing quiz history, Storage objects, or downloaded packs are changed.

**Important limitation:** This is not a full retroactive privacy erase. A learner who recorded a private answer previously may still view their own archived session/answer rows through historical own-row RLS, and already copied media bytes remain accessible offline. An authorized user with a public occurrence of a shared text can still play the public clip; audio hashes are not per-user or per-topic secrets. Sensitive row metadata and historical exports require a later explicit migration/privacy policy decision, not silent deletion.

## Change 2 — Local, read-only media classifier

Source: [tools/audit-kg-private-media.mjs](../tools/audit-kg-private-media.mjs).

Optional local usage (Windows/PowerShell; DO NOT commit the input):

    node tools/audit-kg-private-media.mjs --input D:\private\kg-media-snapshot.json

Input is a manually curated JSON of tables (privateRules, words, wordTranslations, topicTranslations, sentences, colourPhrases, optional mediaObjects with name). The file **may contain private learning text**; retain it locally, do not upload it or print raw contents.

The classifier mirrors the generator's NFC/whitespace-normalized **FNV-1a32** hashing. It categorizes *references* and *observed storage paths* into:
- private_exclusive_candidate — referenced only by private text; **candidate for manual review, NOT proven private**.
- shared — exact normalized text also used in public content; never move/delete the public copy based only on a private lesson reference.
- public_only — all known references in ordinary published content.
- collision_review — multiple distinct texts map to the same 8-digit hash; owner attribution is unsafe.
- unknown_review or unreferenced — missing source mapping or storage objects without matched references; never delete automatically.

Pictures are classified by parent topic and language usage; remote URLs and colour-phrase pictures without proven ownership are marked review-required. Only **aggregate counts** appear in output, not text, hashes, emails, object paths, or media bytes. This tool does not connect to Supabase, generate credentials, upload, migrate, sign or remove files.

**Data audit limitation:** The hash is only 32-bit, not a cryptographic content identity. Unknown, shared and collision entries require source-by-source review. This classifier does not infer whether a public storage link has been cached externally.

## Isolated verification

Workflow: [.github/workflows/kg-u3b3b1-private-media.yml](../.github/workflows/kg-u3b3b1-private-media.yml).

- Invented (not real) users, private lesson rule, vocabulary, words, quiz history and flags.
- PostgreSQL 17 Docker with **--network none**. Sequentially applies U1/U3B1/U3B2/U3B3A schemas, checks the existing private-record test, seeds fictionally preexisting quiz answers and applies U3B3B1 **twice**.
- Checks private legacy topic quiz/answer/rating/flag insert rejection even under existing permissive policy; public writes still work. Unauthorized pronunciation calls deny private/foreign IDs/text while permitted members/admins work. Protected privileged history does not reveal private IDs to a denied learner, but no historical rows are deleted.
- Node test verifies hash parity, public+private shared text classification, collision review, unreferenced objects, incomplete references and sanitized aggregate output.
- The existing full KG Chart offline/unified/Chromium CI must remain green; no physical device was operated.

Synthetic CI success proves only the narrow SQL/proposed-classifier contract, NOT real-media confidentiality or U3 authorization rollout.

## U3B3B2 — next required increment

This is the **remaining media-delivery design/deployment** work and is still NO-GO pending a separate PR:
1. Classify all private and shared text/picture/phrase references using a full **read-only inventory** of production data after verifying backup and privacy handling. Avoid copying any real personal text into GitHub.
2. Create an additional **private Storage bucket** (separately approved SQL/setup), access through verified caller-scoped resource ID and language/topic membership. Never authorize a clip by user-submitted hash/path alone. Consider a short-lived signed-URL proxy or Edge route with strict revocation and source-classification checks; signed URLs may remain valid until expiry.
3. Extend the audio player to pass **word/sentence/topic resource context**, because today it only receives text and language. A shared hash cannot identify the private topic's owner or permission. Topic question/colour phrase/sentence group need the same verified-context mapping. Update picture/media clients and metadata in both online and offline editions without changing same-origin PWA identity.
4. **Copy, never move/delete**, private-only media to staged private storage; verify complete hashes and backup. Preserve public duplicates until the old-client/rollout/rollback plan explicitly approves any deprecation, and warn that old public URLs/CDN/mobile copies cannot retroactively be made secret.
5. Coordinated RLS + Edge + signed-media + manifest + app + offline tests under separate deployment approvals, including playback, byte-range/audio, revocation, Android/iPad, CDN/URL expiry, old PWA and outbox preservation.
6. Protect remaining old privileged paths and historic data separately as needed; do not claim a public bucket confidential.

## Release gates / restrictions

**NO-GO** for restricted-profile publication, protected audio/image delivery, production SQL, Cloudflare changes or Android/iPad rollouts until the coordinated U3B3B2 → U3C → U3D → U4 roadmap and C4D backup/release prerequisites pass with explicit owner approval.

Do not merge/deploy this draft automatically, change live bucket ACL/public status, relocate/overwrite assets, alter OAuth, clear PWA caches, delete browser site storage or packs, reveal actual private names, or change C4C source-pinned artifact hashes. Two pre-existing high-severity npm audit findings remain separate release blockers.
