# Admin backend — CTO review

Reviewed 2026-11-23 against the admin implementation prepared for this pull request. This review covers migration 008, admin HTTP routes/services, authorization, account-profile synchronization, account policy, and the related generation/billing changes. Older token pricing research and provider adapters are outside this review. The last ten commits were inspected; no applicable `CLAUDE.md` was found.

## Summary

The backend implements the requested administration operations with server authorization, validated input, revision conflicts and durable audit records. No blocking defect was found in the reviewed scope. The highest-risk boundary is account-policy changes racing with paid generation submission; owner locking and a final worker policy check enforce that boundary while allowing already accepted jobs to finish.

## Evidence

- All five admin routes call `requireAdmin`. Services independently require a server-allowlisted, active actor. Request bodies cannot supply roles or identities. Responses are private/no-store; mutation routes retain the existing origin protection.
- Mutation requests serialize by actor/request ID before acquiring the target owner lock. A replay returns current target data without another grant; reusing a request for another target or payload fails. Concurrent edits require the expected account revision.
- Token grants, account revision and immutable audit insertion share one transaction. Administrator accounts cannot be blocked through the panel. Simulated purchases and free grants do not increase real-deposit totals.
- Blocking or revoking adult-model access cancels only applicable queued/preparing takes and releases each reservation once. Submitting, running, ingesting and uncertain outcomes retain their reconciliation path. The worker rechecks account status and model permission after reference preparation, immediately before its durable submission marker.
- Discounts are calculated on the server from current account policy and actual references. Changed discounts invalidate stale quotes. A 100% discount produces a valid zero-token reservation and settles exactly once. The test-payment confirmation endpoint rejects live-payment records.
- Profile synchronization uses a fixed Clerk API origin, refuses redirects, checks the response identity, and has a five-second abort deadline. Names and emails are display data only. Existing profile data survives upstream errors; refresh attempts are bounded by database timestamps.

Independently executed `admin.integration.test.ts` and `account-policy.integration.test.ts` against isolated PostgreSQL schemas: **14 passed, 0 failed, 0 skipped**. Tests include HTTP authorization, forged actors, invalid fields, concurrent duplicate grants, request reuse across targets, stale revisions, immutable history, deposit classification, cancellation/release behavior, a policy change inside provider preparation, and recovery of an accepted task after blocking. No real provider generation or live payment was executed.

## Architecture notes

The implementation uses the existing PostgreSQL transaction and owner-lock model; it does not add a second balance store or a client-side authorization mechanism. The audit record supplies actor, target, request ID, before/after policy, reason and timestamp.

NSFW permission currently controls the explicitly declared `h3-eros-max` model. It is not a prompt classifier and does not disable any provider moderation. Real payment collection remains a separate integration; current purchases are marked as tests.

Directory sorting by balance or deposits aggregates ledger/checkouts across users (`server/services/admin.ts:48`). This is acceptable for the current small local product. Pagination bounds the response, not aggregation work; measure this query before a large-account rollout rather than assuming its cost remains constant.

## Deployment risk

**NEEDS COORDINATION**

- Apply migration `008_admin_accounts.sql` before starting this application version. Set `VELA_ADMIN_USER_IDS` only on the server to explicitly approved Clerk user IDs; an empty value denies all admin access.
- Pause new generation admission and stop older workers before changing versions. Old workers do not enforce account policy. Deploy matching app/worker code and preserve accepted-job reconciliation before restoring admission.
- Keep the expanded schema on rollback. Do not roll back to workers that ignore blocking, NSFW policy or token reservations while affected work remains queued or in flight.

## Confidence

**HIGH** for the inspected server contracts and isolated concurrency/security tests. Production-sized query performance, browser acceptance and real upstream paid generation were not established by this review. This is approval of the local implementation, not a production launch certification.

## Verdict

**APPROVE** — no blocking changes requested in the reviewed backend scope.
