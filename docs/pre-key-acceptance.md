# Pre-key acceptance — 2026-11-21

Status: **local pre-key workflow validated**. BytePlus ModelArk is selected. Generation remains disabled in the running development environment. No paid provider request was made.

## Implementation delivered

- PostgreSQL generation jobs/takes, immutable input manifests, exact request replay and atomic output placement.
- Explicit leased worker, image submission, video task polling, durable restart recovery and private output ingestion.
- Reserved media capacity before paid submission. Uploads cannot consume space reserved for pending outputs.
- Original generated image/MP4 bytes, separate previews/posters, restricted provider downloads and authenticated video byte ranges.
- Live model capabilities, truthful disabled/pending/error states, persisted output favorites, safe polling and protection against resurrecting removed canvas nodes.
- Character image placement and explicit limits on direct real-person video references. See [ModelArk setup](modelark-setup.md).

## Browser scenarios observed

Used an isolated Chrome profile, a dedicated Clerk Development account, local PostgreSQL and the existing private S3 configuration. Bundled non-portrait sample photos were fixtures; photo workflow completion does not imply identity verification or generation quality.

| Scenario | Result |
| --- | --- |
| Clerk email/password/test verification; sign-out | Passed; private UI/media and owned recovery drafts cleared, login returned |
| Project rename, prompt, reference upload and reload | Passed; server state survived full reload |
| Reference rename and @ menu | Passed; updated handle, Characters category and pinned published reference |
| Favorite and reload | Passed |
| Face/body workflow with four uploaded photos | Passed; multi-angle approvals, build, publish and reload |
| Reference-sheet source download | Passed; decoded WebP was 2048×1088, not the display preview |
| Replace body photo | Passed; face stayed approved, body/sheet invalidated; old canvas version remained readable |
| Slow upload | Passed; approval and stage navigation disabled while upload was pending |
| Offline edit and Retry | Passed; draft remained visible and the saved text survived reload |
| Two concurrent editors | Passed; stale save rejected, copy preserved local draft, original retained server content |
| Keep a copy reconciliation | Reproduced stale recovery warning, fixed and rechecked; final copy reload was Saved without recovery notice |
| Canvas controls | Observed reference-port Image/Video menu, rename, @ insertion, grouping with Cmd+A/Cmd+G, Undo, fit control and minimap toggle |
| Expanded prompt keyboard | Tab remained inside modal; Escape closed it and returned focus to Expand |
| Disabled generation | Generate disabled with explanatory copy; explicit worker refused to start without configuration |
| Anonymous access | Projects, assets, generations and source files denied; mutations also enforce Origin before authentication |

## UI/UX audit

Applied frontend design review, layout, interaction and runtime audit guidance, plus Ponytail and Vue practices. The normal browser integration was unavailable, so native CDP controlled a separate headless Chrome profile; existing user browser tabs were untouched.

Measured canvas viewports: 320×568, 390×844, 430×932, 844×390, 768×1024 and 1280×800. Also checked character forms at desktop/390px and Library at 430px. No document-width overflow remained in these checks. The canvas is a pannable two-dimensional editor; offscreen nodes are intentional, while fixed editor controls must remain accessible.

Fixed findings:

- Focus on a transformed canvas field could scroll the native container and move tools offscreen. Canvas clipping now preserves toolbar coordinates on resize; measured again with the textarea focused.
- The minimap covered Undo/Redo at narrow widths. Small panes start with it closed; explicitly opened maps leave a 16px gap beyond the tool rail.
- Conflict messages squeezed controls into multiple lines. Narrow headers now give the alert its own row with readable, single-line 32px actions.
- Small project/back/edit/download targets were enlarged. Muted text contrast was improved; the rechecked character form/sheet scans reported no flat-background contrast failures.
- Upload completion and save status are explicit. Offline errors now provide a recovery action instead of raw “Failed to fetch”.

Frozen audit scripts found no unnamed controls on the checked character/library surfaces, and no undersized targets on the final 390px character form. The static dialog focus scan flagged background focus candidates; actual Tab cycling confirmed that the dialog's runtime focus trap contained them. This was not reported as a defect.

The final runtime recorder was installed **before navigation**. It reported zero JavaScript errors, unhandled rejections, resource failures, CSP violations and console errors on the rechecked signed-in canvas/library path. The only console warning was Clerk Development configuration. Eight-second idle windows showed no periodic application requests on the canvas or after leaving it. Nuxt preload/prefetch duplicate script entries were observed; they were not treated as failed requests. These short samples do not establish production performance or behavior of active provider jobs.

## Automated validation and limits

- 54/54 server tests passed with isolated PostgreSQL schemas; none skipped.
- Studio and live client regressions passed, including exact retry, newer edits during copy/reload, recovery ownership and account switching.
- Nuxt typecheck, explicit server TypeScript checking, production build and whitespace checks passed.
- Migration `005_generation_jobs.sql` applied locally. Development health returned `generationEnabled: false`.
- Provider tests use controlled fixtures. They cover payloads, duplicate submissions, worker leases/restarts, unknown outcomes, quotas, storage retry, private ownership and a real bundled MP4's range delivery.

Not certified: actual BytePlus account/model activation, paid image/video execution, moderation, output quality/latency, portrait authorization, production hosting/load, database restore or full codec decoding of arbitrary uploaded video. The app does not accept arbitrary user video uploads. No broad WCAG certification or real-device touch/trackpad claim is made from viewport emulation.

Cleanup completed: the dedicated QA account, its 3 projects, 1 character, 7 assets and 14 private S3 objects were removed. Test credentials and the isolated browser profile were deleted; the separate QA server was stopped. The existing development server remains available. Source and documentation remain local; public release must use the repository's sanitized-history process.
