# KG Chart U3C2A — Verified Sentence Groups and Protected Media Source Context

**Starting main:** \`ac154a863a5a6843f6d0f129e9f9c02645f99052\` (merged U3C1 PR #83).
**Stage:** first reviewable portion of U3C2. **U3C2B player/source-image integration remains pending**.
**NO PRODUCTION CHANGES:** U1–U3B3B2 SQL not installed in Technical Supabase; \`vocabulary-assets\` remains public; no new private bucket, Storage copy, cloud function deploy, OAuth change or restricted learner publication.
**Compatibility:** \`U3C1_SCOPED_UI_ENABLED=false\` remains the default-OFF flag. Existing learners and offline packs remain unchanged.

## Verified current source/data layout

Read-only Technical Supabase inspection showed:

| Language | Sentence rows | Distinct sentence groups |
| --- | ---: | ---: |
| Burmese (my) | 373 | 66 |
| Marathi (mr) | 41 | 8 |
| Tamil (ta) | 56 | 5 |
| **Total** | **470** | **79** |

All 470 current sentence rows have nonempty groups. **None contains a topic ID**: \`kg_chart_sentences\` stores \`language_code\`, \`group_name\`, \`native_text\`, \`english_text\`, etc. The separately translated topics are keyed by \`(topic_id,language_code)\`. Many groups cannot be safely assigned to a specific vocabulary topic by comparing their names or sentence words.

U3C1 deliberately withheld restricted Sentences/Speak. This stage creates the missing **administrator-reviewed mapping** instead of guessing, so that a restricted learner can study only groups attached to an explicitly granted translated topic. No real group is auto-mapped or promoted.

## Proposed, manual SQL contract

File: [sql/kg-chart-u3c2-sentence-topic-mapping.sql](../sql/kg-chart-u3c2-sentence-topic-mapping.sql).

The new table \`public.kg_chart_sentence_group_topic_map\` has \`(language_code,group_name)\` primary key, a validated \`topic_id\`, and \`draft|verified|disabled\` review statuses. A verified row additionally requires reviewer UUID, review date and 64-character evidence SHA-256. Foreign keys ensure that the mapped topic **has a translation in that exact language**. The table uses immediate RLS and an admin-only policy. Nothing in this PR inserts real mappings.

Three server functions, all bound to \`auth.uid()\` and existing allowlist, implement:
1. \`kg_chart_u3c2_can_sentence_group(language,group)\`: preserve legacy ordinary groups, respect private lessons for *all* learners, require verified mapping plus an actual language/topic grant for restricted learners. Missing or draft mapping = DENY for restricted.
2. \`kg_chart_u3c2_can_sentence_session(language,topic,quiz_type)\`: reject new restricted Sentence/Speak sessions without a permitted mapped group and corresponding quiz feature. Existing non-sentence quiz types still rely on prior U3B2 policies.
3. \`kg_chart_u3c2_my_sentence_groups(language)\`: return only the current account's allowable **group/topic IDs**, never the administrator's review records, other learners, their emails or the underlying text. Restricted empty mapping stays empty.

The SQL also replaces the existing \`kg_chart_u3b2_can_sentence(lang,sentence_id)\` body **without changing its signature**. The new body checks the sentence's real language and group, private membership, mapped topic, and quiz feature. Existing U3B2 answer/flag and U3B3B1 pronunciation functions call it, so verified group changes now also guard privileged source access.

Add two \`AS RESTRICTIVE\` policies:
- \`kg_chart_sentences\` SELECT: direct API requests may not bypass verified group/topic grants or private lessons.
- \`kg_chart_quiz_sessions\` INSERT: broad "All sentences" mode is not a universal permission and requires at least one group the learner may actually study.

All existing U3B1/U3B2/U3B3A and U3B3B1 permissive/restrictive policies remain necessary. An approved legacy learner keeps their currently visible ordinary groups. Existing quiz/rating/flag/outbox rows are **not deleted or backfilled**.

**Important mapping limitation:** group review verifies the group-level *assignment*, not each sentence's semantic content. Future additions to a reviewed group inherit its assignment; the admin authoring workflow must re-review the mapping or its evidence digest when adding sensitive sentences. A missing/incomplete group should never be silently guessed by the client.

## Staged learner interface

Files:
- \`js/kg-sentence-access.js\`: strict parser requiring verified \`server_enforced:true\` group snapshots for restricted accounts. Only a group mapped to an actual granted topic may be used. Unknown, duplicate, forged and malformed snapshots fail closed.
- \`js/kg-learner-access.js\`: restricted Sentences/Speak modes appear only when a verified group snapshot includes at least one authorized group. Current U3A and U3C2 SQL say \`server_enforced:false\`, so the restricted modes remain withheld until a future audited deployment gate.
- \`index.html\`: a caller-scoped \`useSentenceTopicAccess\` hook requests no-argument identity information and the explicit current language via \`kg_chart_u3c2_my_sentence_groups\`, refreshes on focus/reconnect, and discards stale account/language responses. Sentence Quiz and Speak only construct their pools from verified groups, intersected with existing \`private_lessons\` filtering. A previous saved group outside grants is not rendered.
- \`tools/build-offline.mjs\`: bundles the **same** parser into the offline/unified shell without changing the PWA identity, IndexedDB schema, worker or downloaded media.

The U3C1 release flag remains **source-controlled and OFF**; this code does not query an uninstalled production RPC. Even after SQL is installed, a separate reviewed release must set both U3A and this group RPC to \`server_enforced:true\` **only after actually proving the corresponding RLS, Edge, media and offline protection**. A UI value alone must never be used as a security assertion.

## Protected media source context (U3C2A foundation)

\`js/kg-protected-media-context.mjs\` adds a source-bound adapter around the existing U3B3B2 \`resolveProtectedMedia\` signer. Its request identifies a real KG Chart:
- vocabulary word/audio or image via UUID and language/topic,
- translated topic question via topic ID + language,
- sentence audio via UUID + language + **verified group**,
- colour-phrase audio via UUID + language/feature.

The client checks known policy scope first; the **server rechecks the live resource** and private media registry for actual authorization. A denied, malformed, unavailable or unmapped source **never falls back to the old public text-hash URL** through this adapter.

This foundation is **NOT yet wired into the existing \`KGAudio.play\`, \`SpeakButton\`, image cards or offline downloads**. U3C2B needs to make that change atomically with private-bucket staging, approved content classification, actual media copy verification, byte-range/playback, signed URL refresh and iPad/Android acceptance. Existing public clips are not claimed confidential.

## Security tests

New CI: [.github/workflows/kg-u3c2-sentence-access.yml](../.github/workflows/kg-u3c2-sentence-access.yml).

- 100% fictional Auth users, private lesson groups, topic translations and media IDs in **network-disabled PostgreSQL 17**; U1 through U3B3B2 SQL applies first, then U3C2 SQL applies **twice**.
- Admin-only map, no anonymous RPC, review evidence requirements, topic translation FK, missing/draft/renamed group denial and legacy preservation.
- Direct SELECT, sentence quiz session/answer write checks, approved member vs excluded member, unknown or unauthenticated users, stale sentence group changes, and the already-prepared private-media signing RPC's inherited group authorization.
- Node tests for unsupported/group-forged policies and no automatic public media fallback.

Existing KG Chart dual-edition CI, U3C1 policy tests and U3B3A privacy regression must stay green. No real Supabase users or private sentence contents are copied into GitHub.

## Next steps / production release NO-GO

1. **U3C2B — Integrated protected player:** Review exact source IDs for all 19+ \`SpeakButton\` occurrences, topic question audio, sentence lines, word/colour quizzes, autoplay, pictures and mobile playback. Keep the shared public audio hash catalog intact until the private asset inventory and backups are verified. Never authorize media by bare text/hash or expose service-role keys.
2. **U3D — Offline policy and media synchronization:** account-scoped policy cache bound to Auth identity/revision, safe reconnect/revocation, non-destructive queued writes and cached private-media review. Previously downloaded public bytes are not retroactively secret.
3. **U4 — Android/iPad acceptance**, including cold start, OAuth, airplane mode, images, audio, quiz, flags, sync and rollback.
4. **C4D** release backups, OAuth/release artifacts and the two existing high-severity npm vulnerabilities remain pending.

No new production tables, RLS, private-media bucket, signed URLs, Cloudflare deployment, PWA reinstall, service-worker uninstall, website-data clearing, downloaded-pack deletion or real restricted-profile publication are authorized by this PR. Keep the branch in a **draft, unmerged** state until explicit review.
