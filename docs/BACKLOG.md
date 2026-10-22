# LineageGuard backlog

Work found after [COMPLETION.md](COMPLETION.md) was closed. Nothing here
changes that plan or blocks it; COMPLETION.md stays the definition of done.

## 2026-10-22 review

Three read-only reviews (engine and API, SDK, site/CI/docs) were checked and
fixed on `fix/review-2026-10-22`; the fixed items are in CHANGELOG.md under
"Unreleased". Every fix has a regression test or eval case that fails on the
code before it. The eval set grew from 77 to 86 cases (precision 95.6%,
recall 100%, specificity 95.3%).

Open:

- [ ] **Release.** The fixes reach users only through a new SDK version
  (suggested 0.10.0, since `toolExecutionStore` and the pipeline's
  `blockAtOrAbove` are new options) and a Sites deploy. The new two-job
  `publish.yml` has not run yet; watch its first release.
- [ ] **Snapshot size.** Each cached handoff decision stores a full report,
  so 49 keyed handoffs of 1.47 M characters made a 42.5 MB snapshot. Storing
  only `{status, output, reason, stageId}` changes the persisted snapshot
  format, so it needs a schema version and a migration path.
- [ ] **False positives left as they are.** An added sentence with "will" is
  a medium "Confidence was inflated"; `07/24/2026` vs `2026-07-24` is a high
  number change (month/day order is ambiguous without a locale).
- [ ] **Coverage heuristic.** A short German guardrail ("Keine E-Mails an
  Kunden senden ohne Freigabe…") passes the English-function-word check
  because "an" counts as English; Korean and other non-Latin guardrails are
  reported.
- [ ] **Label size.** Labels at 7–8 px now meet the contrast ratio but are
  still very small; a size floor of about 11 px would change the layout.
- [ ] **GitHub email.** Merge commits made in the GitHub web UI carry the
  account's email. Turn on "Keep my email address private" in GitHub's
  settings; rewriting history is not worth it.
