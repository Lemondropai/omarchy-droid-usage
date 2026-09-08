# Security Review Report

## Scope

- Commit range: `36d3541..f776ec0`
- Files analyzed: `droid-usage.mjs`, `test/droid-usage.test.mjs`, `.factory/threat-model.md`
- Threat model: version 1.0.0

## Result

No confirmed security findings. The response-body denial-of-service issue
reported by the Omarchy review team is fixed.

## Verified controls

- Factory API bodies are read as streams with a strict 256 KiB byte cap.
- Numeric `Content-Length` values above the cap, and invalid numeric values, are
  rejected before reading.
- The reader is cancelled when cumulative bytes exceed the cap and its lock is
  released on every path.
- Parsed payloads reject arrays, oversized records, oversized arrays, and
  nesting deeper than eight levels before usage processing.

## STRIDE results

| Category | Result |
| --- | --- |
| Spoofing | No authentication-path changes |
| Tampering | No new injection or prototype-pollution path |
| Repudiation | Read-only collector; no new audit requirement |
| Information disclosure | Token remains in memory and is sent only to fixed Factory HTTPS endpoints |
| Denial of service | Reported unbounded response-body allocation is mitigated |
| Elevation of privilege | No privilege or launcher changes |

## Filtered candidates

Deeply nested JSON and a response chunk crossing the threshold were reviewed
as candidates. They were not reported: failures are caught and degrade to the
stale record, while the stream reader cancels as soon as cumulative bytes
exceed the cap.

## Validation evidence

- `npm test`: 12 passed
- `npm run check`: passed
- `qmllint -I /usr/lib/qt6/qml Agent.qml Main.qml Panel.qml`: passed
- `omarchy plugin validate .`: passed
- `npm audit --json`: 0 vulnerabilities
- `git diff --check`: passed
