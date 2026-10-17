# Mobile Dependency Security

**Reviewed:** 2026-10-13; rechecked 2026-10-17 (commit `4e35aca`)

## Current Findings

The mobile lockfile contains 21 high-severity package records (20 at the first review) from the same two distinct advisories, at the same installed versions; every record is on a path to `braces` or `node-forge`. Both are transitive through Expo SDK 57 tooling. `npm audit --omit=dev` reports the same records because Expo and Expo Updates are runtime dependencies in `package.json`, even though the affected Node packages are not part of the iOS or Android application runtime.

| Package | Installed | Advisory | Affected behavior | Dependency path |
| --- | --- | --- | --- | --- |
| `braces` | 3.0.3 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), CVE-2026-93687, High | Deeply nested brace patterns can exhaust the JavaScript call stack in recursive AST walkers and terminate the Node process. | `expo` -> `@expo/cli` -> `@expo/metro` -> `metro-file-map` -> `micromatch` -> `braces` |
| `node-forge` | 1.4.0 | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), CVE-2026-85393, High | RSA PKCS#1 v1.5 verification can accept a forged signature when a nested `DigestAlgorithm` contains extra elements; the advisory describes low-exponent RSA keys. | `expo` -> `@expo/cli` -> `node-forge`, and `expo-updates` -> `@expo/code-signing-certificates` -> `node-forge` |

The GitHub advisories list no patched release. The npm registry currently publishes `braces` only through 3.0.3 and `node-forge` only through 1.4.0 (rechecked 2026-10-17). The Quran audio dependency added on 2026-10-17, `expo-audio@57.0.5`, is not on any affected path and adds no advisory. The backend lockfile has no findings (`npm audit` and `npm audit --omit=dev`: 0). Expo SDK 57 is already at its latest 57.x Expo, Expo CLI, and Expo Updates versions. `@expo/code-signing-certificates@0.0.7` is published, but it still depends on `node-forge@^1.4.0` and does not fix this advisory. The `braces` depth-guard change is not published to npm; the node-forge correction remains an upstream pull request, not an npm release. Do not apply a major downgrade or an unverified override to clear the audit.

## Reachability And Impact

- **`braces`:** This is build tooling. Metro's file-map watcher calls `micromatch` to test file paths against configured glob filters. The affected parser is reachable while developing, bundling, or running an EAS build that uses Metro. No application source imports `braces`; it is not shipped as app JavaScript or executed on user devices. No ordinary app request path was found that supplies a brace pattern to Metro. The denial-of-service scenario requires a deeply nested pattern to reach the build-time matcher, so treat project glob configuration and build dependencies as trusted input.
- **`node-forge`:** This is Node-based Expo CLI and code-signing tooling. Expo CLI uses it to parse local macOS signing certificates; the Expo Updates CLI uses the code-signing certificate helper for local certificate/key generation and configuration. The vulnerable signature verification is not used by the app's JS entry point. Installed iOS and Android clients perform update-signature verification in their native implementations, not with this Node package. No path was found that feeds an attacker-supplied network signature into node-forge in the mobile app runtime.
- **Build and release systems:** Both packages are present in the install tree used by development and tooling. Metro runs during JS bundling, including EAS builds. The audited dependency presence alone does not mean either library is bundled into the released app, but the Metro denial-of-service risk remains for build jobs if an attacker can influence glob configuration. The node-forge finding is limited to tooling paths that parse or verify local code-signing material; the cited signature-forgery primitive is not reached by the app's native OTA verifier.

## Mitigations And Follow-Up

- Keep Metro development servers on localhost or trusted networks; do not expose them to untrusted clients.
- Do not construct Metro watch/block globs from untrusted network or user input. Review changes to build configuration and dependency scripts as executable code.
- Use trusted local certificate and private-key files with Expo code-signing commands; do not process certificates supplied by untrusted parties with the affected CLI.
- Keep the lockfile reproducible and rerun both `npm audit` and `npm audit --omit=dev` when Expo publishes SDK-compatible package updates. Recheck whether the upstream fixes have shipped before changing the Expo SDK or dependency graph.

## Release Decision

No safe, published, SDK 57-compatible dependency fix was available at this review. No dependency changes were made. The identified vulnerable Node code is confined to build/development/code-signing tooling; this investigation found no path into installed mobile-app execution, offline Quran data, authentication, encrypted reflections, or user data.

If the release gate requires a zero-high `npm audit`, public release remains blocked until the upstream fixes are published and can be adopted compatibly (or the security owner formally accepts a time-bounded exception). If the gate assesses shipped application runtime rather than the full Expo toolchain, record and approve the residual build-tooling risk, keep Metro private, and track the upstream releases before the next build.