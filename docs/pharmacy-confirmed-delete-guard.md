# Confirmed count deletion protection

This change protects confirmed pharmacy items (`SRC`, `KKL`, `SSS`) from unconditional deletion by cached or offline clients. Progress continues to advance on the first scan of each countable SKU. WH behavior stays unchanged.

## Evidence and local backups

Read-only historical investigation on 8 November 2026 found confirmed KKL results missing on the days after confirmation. The responsible device and command have not been identified. The private item list and historical data stay in local ignored backups.

Local files are excluded from Git by the existing `stock_backup_*.json` rule:

- `stock_backup_KKL_20261108_before_delete_guard.json`: current state at a consistent read time.
- `stock_backup_KKL_20261103_confirmed.json`: historical confirmed state.
- `stock_backup_KKL_20261104_confirmed.json`: historical confirmed state.
- `stock_backup_KKL_missing_review.json`: distinct missing items with their latest available historical source document. No production records have been restored. Inventory movements since counting must be reviewed, or the items recounted, before restoration.

`tools/backup-firestore-branch.py` uses GET requests only and retains Firestore REST typed values. Existing backup files are never overwritten. Add `--include-delete-intents` only after publishing the new rules.

## Deletion protocol

For confirmed pharmacy items (`pass`, `audit`, `audit_check`, `stock_adjustment`), rules require a matching `stock_sessions/{branch}/delete_intents/current` write in the same transaction or batch. It records the reason, actor, and expected source epoch, revision, status, and update timestamp. Its server timestamp must equal the request timestamp; an earlier intent cannot authorize a later delete. A changed source rejects the entire request.

Explicit start-new-count, administrator clear, epoch cleanup, and Stock Adj rescan use the protocol. A rescan retry verifies the original count result and preserves a newer confirmation. The normal X action checks the server and adopts an already-confirmed result instead of deleting it.

Reset also waits for every cleanup operation to settle before rebuilding the new round, including when one metadata operation fails. An update against missing metadata reaches the normal `not-found` response instead of failing rules evaluation.

Empty audit-log migration now reads the live session and marker in a transaction. It preserves existing marker items and metadata and checks the round before marking migration complete. A stale local cache must never overwrite an authoritative marker map with `items:{}`.

The fixed intent document is shared within a batch, keeping rule lookups within [Firestore access limits](https://firebase.google.com/docs/firestore/security/rules-conditions#access_call_limits). It retains the latest deliberate deletion request, not a complete audit history. This protocol prevents accidental deletion by old clients; it does not add Firebase Authentication or change the project's existing identity model.

## Rollout order

1. Keep the KKL backups and finish emulator checks. Review the exact `firestore.rules` diff.
2. Publish the complete new `firestore.rules` in Firebase Console for project `stock-count-1d6e7`.
3. Deploy the matching `index.html` immediately afterwards. Rules must come first because the web writes a new subcollection. During this short interval, the old web cannot intentionally delete confirmed pharmacy items; scans and Confirm keep their existing paths.
4. Confirm the deployed web contains `_writePharmacyDeleteIntent`. After each workstation has synced its local scans, reload Desktop and fully close/reopen PDA. Do not start a new count to refresh the application.
5. Validate scan Progress, night Confirm, and the next resume on KKL. Keep the historical missing-item list for a separate inventory review; do not restore historical quantities automatically.

Publishing the file in Git does not publish Firestore rules. Use Firebase Console, or the rules-only CLI config with an account authorized for this project:

```powershell
node tests/node_modules/firebase-tools/lib/bin/firebase.js deploy --only firestore:rules --project stock-count-1d6e7 --config firebase.rules.json
```

Before publication, fetch and retain the currently published rules and compare them against the base rules; preserve any unrelated live changes. The existing CLI account returned HTTP 403 when listing project rule releases on 8 November 2026, so the project owner published the rules through Firebase Console and confirmed completion. A subsequent unauthenticated GET of `stock_sessions/KKL/delete_intents/current` returned `404` instead of the previous `403`, verifying that the new intent read path is active. This read-only check does not verify the complete published rules source; deletion behavior was verified in the emulator. The matching web deployment follows this check. No production count records have been restored.

## Validation

Full validation: 760 logic tests passed, 4 skipped. The full emulator run had 169 passes, 2 opt-in skips, and one existing WH rules fixture failure (`recheckRead:false`). That fixture now uses separate bare SDK clients for rejected-create and seeded-read phases, without app bootstrap/cache interference. All five WH rules tests then passed three consecutive repetitions (15/15), covering the remaining case. Production sources did not change after the full run. Current coverage is 930 distinct passing cases and 6 intentional skips; the original full command exited with the fixture failure before that correction, so it is not recorded as a clean single-run pass.

The emulator suite exercises old-client single and mixed-batch deletes in all three pharmacy branches; stale-intent replay; a source changed after read; 451-item bulk deletion; actual start-new-count and administrator clear; delayed X; rescan retry against a newer result; reset cleanup failure; preservation of live markers against an empty log migration; and WH compatibility. Existing rescan, overnight, migration, cleanup, and Progress suites also pass. Inline scripts parse and `git diff --check` passes. Physical PDA acceptance testing remains part of rollout.

## Rollback

Keep the previous deployed rules before publication. If rollback is required, restore the preceding rules, then the preceding web revision. Restoring the old web while leaving the new rules published blocks deliberate confirmed deletion until a matching web is deployed. Restoring the old rules also restores the old-client deletion risk.
