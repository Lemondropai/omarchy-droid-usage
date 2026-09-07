# Droid Usage Security Threat Model

Version: 1.0.0
Last updated: 2026-09-07

## 1. System Overview

Droid Usage is an unsandboxed Omarchy Quickshell bar plugin. QML renders the
panel and starts a local Node.js collector every 20 seconds. The collector
reads the existing encrypted Droid CLI login, sends its access token only to
Factory API endpoints over HTTPS, and writes a reduced usage snapshot for the
panel. Right-clicking the widget starts the local Droid CLI in an Omarchy
terminal.

Components:

- `Panel.qml`: bar interaction and usage display
- `Main.qml`: collector scheduling and snapshot model
- `Agent.qml`: usage snapshot parser
- `droid-usage.mjs`: credential decryption, API reads, normalization, and
  atomic snapshot writes

External dependencies are Omarchy Quattro, Quickshell, Node.js 18+, the Droid
CLI, Factory API availability, and optionally `secret-tool`.

## 2. Trust Boundaries

1. **Local desktop boundary:** Quickshell runs the plugin with the user's
   permissions. Plugin source and user-controlled configuration are trusted.
2. **Credential boundary:** encrypted files and the system keyring contain
   authentication material. Only the collector reads them.
3. **Network boundary:** usage requests cross from the local machine to
   `api.factory.ai` over HTTPS. Responses are authenticated but still parsed
   defensively.
4. **Snapshot boundary:** the collector writes account usage to a mode-`0600`
   file. QML treats malformed JSON as unavailable data.

## 3. Attack Surface Inventory

- Local plugin source and QML settings
- Droid encrypted credential files and keyring entries
- Factory billing-limit and compute-usage HTTPS responses
- Local usage snapshot and pool-preference files
- The right-click terminal launcher

The plugin has no listening socket, public HTTP endpoint, package installer,
privileged operation, or remote code execution path.

## 4. Critical Assets

- Factory access and refresh tokens: high sensitivity; never written to the
  snapshot, console, README, or repository
- Droid encryption keys: high sensitivity; read locally and never transmitted
- Usage totals and reset times: account metadata; stored locally with mode
  `0600`
- Plugin source integrity: important because Omarchy plugins are unsandboxed

## 5. Threat Analysis

### Spoofing

An attacker who replaces local credential files or keyring entries could make
the collector authenticate as another account. Existing OS file permissions
and keyring access are the control. The collector also rejects malformed and
near-expiry JWTs.

### Tampering

A local process running as the same user could replace plugin source,
preferences, or the snapshot. The collector uses a unique temporary file and
atomic rename, creates the state directory as `0700`, and writes snapshots as
`0600`. Factory responses are normalized and bounded before display.

### Repudiation

The plugin performs read-only API requests and does not claim to provide an
audit trail. The snapshot timestamp indicates freshness but is not a
tamper-proof log.

### Information Disclosure

The main risk is accidental token logging or persistence. The collector keeps
credentials in memory, sends the access token only in HTTPS Authorization
headers to Factory, suppresses credential-helper stderr, and emits only the
reduced usage record. Errors use fixed messages rather than response bodies.

### Denial of Service

Factory or the keyring may be unavailable. Requests have five-second timeouts,
collector runs do not overlap, and the panel retains the last successful
snapshot marked stale. API payload size is not explicitly capped, but the two
authenticated endpoints are controlled by Factory.

### Elevation of Privilege

The plugin uses no `sudo`, `pkexec`, setuid binary, service manager, or package
manager. The right-click action launches only the user's installed Droid CLI
with the user's existing permissions.

## 6. Vulnerability Pattern Library

### Secret disclosure

Unsafe:

```js
console.log(credentials.access_token);
writeFileSync("debug.json", JSON.stringify(credentials));
```

Required: never log, persist, or return decrypted credentials or Authorization
headers.

### Command injection

Unsafe:

```qml
bar.run("sh -c '" + settingValue + "'")
```

Required: launcher commands must use fixed executable paths and must not
interpolate untrusted API or snapshot values.

### Path traversal

Unsafe:

```js
writeFileSync(`${stateDir}/${remoteName}`, data);
```

Required: state paths remain fixed local paths derived only from `HOME` or
`XDG_STATE_HOME`.

### Untrusted response handling

Unsafe:

```js
const ratio = payload.used / payload.limit;
```

Required: verify object shape, coerce finite numbers, reject invalid limits,
and clamp displayed ratios.

SQL injection, XSS, authentication bypass, and IDOR patterns do not apply
because the plugin has no database, HTML renderer, or server endpoint.

## 7. Security Testing Strategy

- Unit-test percentage, reset-time, stale-data, compute-usage, and JWT-expiry
  normalization.
- Run Node syntax checks and QML lint before release.
- Scan every release for credentials, machine-specific paths, executable
  downloads, privilege changes, and shell interpolation.
- Review the exact commit submitted to the Omarchy Plugin Registry.
- Test installation and removal on a clean Omarchy Quattro environment.

## 8. Assumptions and Accepted Risks

- The local user account, Omarchy installation, Droid CLI, Node.js runtime,
  and Factory HTTPS origin are trusted.
- Factory API and Droid encrypted-storage formats are not stable public
  interfaces and may change.
- Same-user processes can access data available to this unsandboxed plugin.
- Displaying account usage in the desktop bar is intentional.

## 9. Changelog

- 1.0.0 (2026-09-07): Initial STRIDE threat model.
