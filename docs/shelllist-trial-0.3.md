# Shelllist v0.3 trial

Project: local sibling `../shelllist` checkout, `main`

The trial ran inside Shelllist's Nix development environment so its pinned Qt 6.11.1 and Quickshell type information were available. Shelllist has no CMake project; its Nix checks are the authoritative build integration, so the CMake adapter was correctly reported as not applicable.

## Evidence executed

- Shelllist's `tests/run-qmllint.sh`: exit 0, no diagnostics.
- `qmlformat` 6.11.1 comparison over 151 QML/JavaScript files.
- `qmltestrunner` over `tests/qml`: 38 executed JUnit cases, no failures.
- Shelllist's `tests/run-qml-tests.sh` as an offscreen runtime-smoke scenario: exit 0, no recognized runtime QML warnings.
- Static analysis over 160 source files, including 131 QML files and 20 JavaScript files.

No representative QML Profiler trace exists in the checkout, so runtime performance was left unconfigured rather than fabricating evidence. The checked-in Qt integration fixture separately exercises the Chrome-trace adapter and performance-budget path.

## Results

| Evidence | Result |
| --- | --- |
| Internal parser | 0 diagnostics |
| Project resolver | 0 unresolved imports, 0 unresolved types |
| qmllint | clean configured command; command scope recorded as unknown |
| Qt Quick Test | 38 executed, 0 failures |
| Runtime smoke warnings | 0 recognized warnings |
| qmlformat | 122 of 151 files differ |
| Heuristic maintainability score | 90/100 |
| Quality-contract verdict | warn |
| Audit | 0 blocking, 122 warning, 684 review, 0 incomplete |

The resolver initially reported `MultiEffect`, `Controls.ItemDelegate`, and an owning-module `JsonlDaemonClient` as unresolved. Manual review showed all three were false positives. The v0.3 resolver was corrected to understand externally qualified aliases, owning `qmldir` module scope, and `MultiEffect`; the rerun produced zero unresolved types.

## Manual finding review

- **Formatting:** 122 drift records are credible, but Shelllist has no checked-in `.qmlformat.ini` and has not adopted repository-wide `qmlformat`. Keep this as warning evidence until the project deliberately pins formatting; do not create unrelated formatting churn.
- **Internationalization:** the sampled untranslated strings are user-facing and useful production-readiness findings. They remain review-level because Shelllist has not yet adopted translation infrastructure.
- **Function annotations:** 234 findings reflect Qt's recommendation but are too numerous for an immediate gate. Apply annotations to changed/reused functions first.
- **Unused public API:** 233 property/signal candidates need component-owner review because QML module APIs and dynamic use can be difficult to prove statically. They remain cleanup review candidates, not defects.
- **Accessibility:** two pointer-without-keyboard findings in `launcher/ApplicationDetails.qml` require manual interaction review against the surrounding list keyboard actions.
- **Hotspots:** `BluetoothAdapterSettings.qml`, `ClipboardDetailCards.qml`, and `ApplicationDetails.qml` are credible review priorities because of binding pressure, depth, or size. No universal threshold violation is implied.
- **Component contract:** `DaemonBackend.active` is a credible `required` candidate because every resolved user supplies it.

## Adoption recommendation

1. Keep Shelllist's Nix `qmlLint` and `qmlTests` checks authoritative.
2. Add a checked-in `.qmlformat.ini` only as a focused project decision, then ratchet formatting by changed files.
3. Add translation infrastructure before promoting untranslated strings.
4. Capture a representative startup/open/list-scroll trace on target hardware before adding performance budgets.
5. Use changed-code audit gating for review findings; block only verified tool/test/runtime failures.
