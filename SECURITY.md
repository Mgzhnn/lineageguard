# Security Policy

## Supported versions

Security fixes are applied to the latest released minor version. Before a
public npm release exists, use the latest commit on `main`.

## Reporting a vulnerability

Please use GitHub's private security-advisory flow for
`Mgzhnn/lineageguard`. Do not include approval tokens, tenant credentials,
private traces, personal data, or exploit details in a public issue.

Include the affected version or commit, the entry surface, impact, minimal
reproduction, and any suggested mitigation. Maintainers should acknowledge a
complete report within seven days and coordinate disclosure after a fix is
available.

## Security boundary

LineageGuard is an enforcement component inside a host runtime. The host must:

- keep tool implementations outside model-controlled code;
- issue and verify scoped approval tokens through an authenticated service;
- persist snapshots in a trusted transactional store;
- prevent callers from bypassing registered tools;
- redact sensitive GenAI trace content before export or retention;
- provide distributed locking and globally coordinated quotas when required.

The library fails closed for invalid approvals, corrupted snapshots, missing
OTLP source provenance, and invalid enforcement configuration. It does not
verify that source claims are true and is not a substitute for compliance,
medical, legal, or safety review.

## Dependency audit policy

CI runs `pnpm run audit:security` and fails on high-severity advisories except
for the two explicitly reviewed exceptions below. New unfixable advisories are
not ignored automatically.

As of August 17, 2026, the remaining unfixable findings are two denial-of-service
advisories in `image-size@2.0.2`, pulled in by Vinext as development tooling.
LineageGuard does not expose image uploads or call this parser at runtime. Keep
tracking GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq, and remove this exception
as soon as Vinext or `image-size` publishes a fixed dependency path.
