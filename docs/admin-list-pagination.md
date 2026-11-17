# Administrative listing pagination

## Audit and scope
The existing authenticated listing API already paginated with `page`, `limit`,
exact count and `hasMore`. The UI fetched up to twenty 100-row pages before
rendering, defaulted to all loaded rows, and searched only those cached rows.
Changing the old selector to 50 reduced rendering but not the download.

The UI now requests only the current page (default 50; options 25/50/100/200).
Search, event, status and page-size changes reset to page one. Search is
debounced 250ms, with immediate invalidation of older requests. Late success,
failure and session responses cannot replace newer results. Previous/next are
disabled while loading. A refresh after removing the final row on a page
requests the last valid page. Existing mutation endpoints/builders are unchanged.

Server search runs before range pagination across name, participant email,
buyer email, order session, event slug, distance and BIB. Existing event/status
allowlists and server-validated bearer/admin allowlist remain unchanged.
The API retains its omitted-limit default of 100 for other consumers and raises
the cap to 200. Equal timestamps have an ID tie-breaker. PostgreSQL LIKE wildcard
escaping is separate from quoted PostgREST value encoding; see the
[official grammar](https://docs.postgrest.org/en/v13/references/api/url_grammar.html).
Existing 80-character search limit remains. No migration or new index is needed
for this change; production database latency has not been measured.

## Verification
- Parent focused listing/UI/targeting/editor checks: 54/54 passed.
- Independent final broader admin checks: 160/160 passed, no skipped tests.
- Full baseline: 1351 tests,1327 passed,24 failed. Initial candidate:1357 tests,
  1332 passed,25 failed. The sole additional failure extracted the removed local
  `filterRows` helper; updated to execute the actual server-request contract.
  Independent targeted editor recheck:13/13. Full suite not rerun after that
  test-only correction; the other24 failures matched baseline.
- Real page in fresh isolated Chrome, mocked auth/API, synthetic2505 rows:

| Initial view | Baseline | Candidate |
| --- | ---: | ---: |
| Listing requests |20|1|
| JSON response bytes |892993|21769|
| Rendered rows |2000|50|
| Desktop observed milliseconds |2608|213|
| Mobile observed milliseconds |1635|213|

Times are single-run fixture observations, not production benchmarks or SLA.
Transfer and rendered-row reductions are about97.6% and97.5% respectively.
Desktop/mobile navigation, search for record2504 (beyond the previous2000-row
cap), empty results and disabled pager checked. No page-wide mobile overflow
or runtime exceptions. No real PostgREST execution or production session used.

Screenshots/logs retained locally outside the repository:
`%TEMP%/pagination-verify-5ea2db4bc8be47b799d5681d9de11317/`:
`baseline-desktop.png`, `candidate-desktop.png`, `baseline-mobile.png`,
`candidate-mobile.png`, `browser-results.json`, suite and correction logs.

## Release boundary
Exclusive branch/worktree `fix/admin-list-pagination` / `.worktrees/admin-list-pagination`.
No real registrations changed; no migration, merge or deployment performed.
PR14 and chatbot worktree remain untouched. The chatbot has separate uncommitted
UI/backend work and still requires its own integration/security verification.
Concurrent *database inserts* can shift offset pages between requests; the stable
sort prevents timestamp ties but does not create a cross-request snapshot.
