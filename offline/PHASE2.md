# Unified Phase 2 — shared pictures and reconnect synchronization

Based on merged Phase 1 and audio follow-up (PRs #50 and #51).
No deployment, Supabase schema change, production data write, or browser data reset.

## Storage and compatibility

New-format packs hold empty picture-reference responses carrying the content SHA256.
Actual picture bytes are stored once per account/content hash in
`kg-offline-pictures-v1-<owner>`. Language-specific vocabulary remains in each pack's
IDB data; its audio and catalog remain in its own pack cache. Different revisions of
an image coexist, preserving an older pack's ability to read its original bytes.

Both the runtime and worker resolve references. New-format writes are enabled only
when the controlling worker advertises support. Older controllers continue to get
full legacy responses. Reads support both formats. On a pack check/update, legacy
packs can acquire shared references; previous packs are retained for recovery.
Old duplicate bytes are deliberately NOT deleted. Phase 3 must verify devices and
migration before reclaiming legacy copies. This does not transfer cross-origin data.

Verified staging is resumable. Unchanged ETags/Last-Modified revisions are reused even
for refresh, except missing-picture placeholders which are checked again. Without a
reliable publisher revision, downloading and hashing is still required. A cached pack
is no longer declared ready solely because its candidate metadata matches: required
files go through verification. Remaining size stays unknown if any size is unknown.

## Synchronization

Reconnect triggers progress synchronization independently of Wi-Fi-only/content
update preferences. It does not trigger forced cellular content downloads. A download
completion also schedules a sync attempt. Existing authenticated server checks,
outbox IDs, acknowledgment reads and retry behavior are retained.

Account-generation guards stop continuing operations after logout/account changes.
Unsent work remains in its owner queue. Expired login and rating conflicts surface as
errors and retain queued changes; there is no automatic conflict resolution UI.
Conflict detection uses existing server read/write/read APIs, not a new atomic
compare-and-swap RPC. Simultaneous server writes can still race; stronger atomic
conflict resolution would need a separately reviewed database contract. No new SQL
has been applied or assumed.

## Validation and release gates

Run `npm run check:unified`. Automated tests cover content deduplication, per-language
audio separation, legacy reads, replacement revisions, missing/corrupt shared bytes,
older-worker compatibility, worker restart reads, interrupted download resume,
unchanged refresh reuse, duplicate progress retries, expired sessions, reconnect on
cellular, conflict retention and logout during sync. Existing builds remain covered.

Android/iPad real Airplane-mode playback, refresh, cold reopening and production
migration remain acceptance gates. Test a preview with disposable data first. Keep
existing Burmese and Chinese downloads and exported recovery until final migration
is verified. Do not merge or deploy without explicit owner approval.
