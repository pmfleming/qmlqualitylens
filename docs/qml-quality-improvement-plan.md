# QML Quality Lens implementation plan

This historical plan turns the [QML quality research](qml-quality-research.md) into an implementation sequence. Its central principle is that verified correctness, project policy, and heuristic review are distinct. One composite score cannot define good QML.

> **Status:** The baseline for every milestone was implemented by 0.5. Version 0.3 added execution and evidence policy; 0.4 added type and parser precision; 0.5 added coverage, benchmarks, reachability, and GitLab output. The [roadmap](../ROADMAP.md) tracks remaining calibration and framework work.

## Product goal

Make qmlqualitylens the orchestration and architecture layer around Qt's own tools:

- use `qmllint`, `qmlformat`, the Qt Quick Compiler, Qt Quick Test, and runtime traces as authoritative evidence where available;
- add high-value QML-aware architectural checks that Qt tools do not provide;
- explain the source, confidence, and enforcement policy of every finding;
- support incremental adoption through changed-code gating, baselines, and justified suppressions;
- remain useful in dependency-free static mode without pretending that heuristic output is equivalent to Qt type information or runtime measurement.

## Baseline when this plan was written

### Capabilities to preserve

The project already has a useful foundation:

- a dependency-free QML lexer/parser with object scopes, grouped and attached properties, handlers, functions, multiline bindings, and `id` references;
- local file, `qmldir`, import, type, and component-use resolution;
- configurable `qmllint` report/command ingestion;
- binding-loss, binding-cycle, layout, `Connections`, API-use, cleanup, locality, clone, and performance-smell rules;
- split JSON artifacts with provenance/confidence;
- suppressions and stale-suppression reporting;
- changed-file/hunk audit support with base-worktree comparison;
- an opt-in `qmllint` calibration tier.

### Original gaps

These gaps motivated the plan; they do not describe current behavior.

1. `audit` excluded normalized `qmllint` diagnostics.
2. Severity, confidence, authority, and enforcement were conflated.
3. The composite score obscured the difference between rules, facts, and policy.
4. Tool provenance did not distinguish a clean run from missing or incomplete evidence.
5. Broad `Loader` and `Image` heuristics produced noise.
6. Test discovery was presented without execution evidence.
7. The parser lacked types, modifiers, source order, string context, and richer relationships.
8. Accessibility, interaction, translation, theming, and runtime performance lacked evidence.

## Design principles

### 1. Three evidence classes

Every finding and every report summary should identify one of:

- **Verified/tool evidence**: emitted by `qmllint`, compiler diagnostics, test results, runtime warnings, or a deterministic formatter comparison.
- **Static semantic evidence**: derived with high confidence from parsed QML, such as a proven binding cycle or anchors on a layout-managed child.
- **Heuristic review evidence**: size, complexity, coupling, style literals, likely performance smells, or likely missing UX behavior.

Only the first two should be eligible for default blocking, and only when their required inputs are complete. Heuristics should default to review/warn and changed-code ratcheting.

### 2. Separate impact from certainty and enforcement

Extend `Finding` with fields similar to:

```ts
type Finding = {
  // existing identity, location, message, and action fields
  severity: "low" | "medium" | "high";       // likely impact
  confidence: "low" | "medium" | "high";    // certainty of diagnosis
  evidence: "tool" | "semantic" | "heuristic";
  enforcement: "block" | "warn" | "review";
  category: "correctness" | "architecture" | "performance" |
            "testing" | "accessibility" | "i18n" | "style" | "security";
  authority?: {
    kind: "qt" | "project" | "tool" | "lens";
    name: string;
    url?: string;
    rule?: string;
  };
};
```

Keep schema migration backward-compatible for one release by retaining existing fields and providing defaults when reading old baselines.

### 3. Explain skipped and incomplete checks

Each check should report `pass`, `fail`, `warn`, or `skipped`, plus a reason. “No diagnostics” is a pass only when the tool ran successfully with usable type/import information. Otherwise it is `skipped` or `incomplete`.

### 4. Prefer Qt tools over duplicate heuristics

Do not reimplement a weaker version of a `qmllint` check merely to increase rule count. Normalize and explain the official diagnostic. Add lens rules where project-wide structure, lifecycle, architecture, security, or runtime evidence is required.

### 5. No universal thresholds disguised as standards

File size, object count, complexity, clone, API-surface, and coupling limits remain configurable hotspot thresholds. Reports and rule metadata must label them as lens/project policy, not Qt recommendations.

## Target artifact model

The plan introduced `quality_contract.json` to answer CI questions directly:

```json
{
  "summary": {
    "verdict": "pass|warn|fail|incomplete",
    "verified_failures": 0,
    "semantic_failures": 0,
    "review_findings": 0,
    "skipped_checks": 0
  },
  "checks": [],
  "findings": [],
  "dimensions": {
    "correctness": {},
    "maintainability": {},
    "testing": {},
    "runtime_performance": {},
    "accessibility": {},
    "i18n": {}
  }
}
```

Keep `qml_quality_report.json` during migration, but rename its displayed score to **heuristic maintainability score** and stop using it as the primary CI verdict. The contract and audit verdict become primary.

## Milestone 0 — Evidence and gating correctness

**Purpose:** fix misleading behavior before adding rules.

### Work

1. Add finding metadata: category, evidence class, confidence, enforcement, authority, and stable fingerprint.
2. Create a central rule registry containing:
   - rule id and title;
   - default metadata and enforcement;
   - configuration keys;
   - authoritative/documentation links;
   - whether the rule requires resolution, `qmllint`, runtime data, or a framework profile.
3. Include normalized `qmllint` findings in the audit input.
4. Change audit verdict calculation to use enforcement policy, not raw severity alone.
5. Add an `incomplete` verdict for required checks that did not run or ran with unusable inputs.
6. Add configuration for:
   - `require_qmllint`;
   - fail/warn behavior by evidence class or rule;
   - new-code-only gating;
   - enabled project/framework profile;
   - rule overrides and justified suppressions.
7. Version artifact schemas independently from the package version and document migration.

### Acceptance criteria

- A configured `qmllint` error appears in `audit.json` and causes the configured blocking verdict.
- A missing required `qmllint` tool/report produces `incomplete`, not a clean pass.
- A high-impact but low-confidence heuristic does not fail CI by default.
- Every emitted finding resolves to one rule-registry entry.
- Existing baseline files continue to load, with a documented fingerprint migration path.
- Unit tests cover pass, warn, fail, incomplete, suppression, and changed-code behavior.

## Milestone 1 — First-class Qt toolchain integration

**Purpose:** make authoritative Qt evidence reliable and reproducible.

### `qmllint`

- Prefer structured JSON output and retain raw diagnostics for debugging.
- Add fixtures for the actual JSON/text formats of supported Qt releases.
- Capture tool version, command, exit code, settings file, import paths/build directory where observable, and whether compiler warnings were enabled.
- Report warning-category counts and disabled/unknown categories where available.
- Detect command success with unparsable output as an integration error.
- Preserve a clean successful run as observed evidence even when it has zero findings.
- Deduplicate lens findings that represent the same issue and location as `qmllint`, preferring the Qt diagnostic.

### `qmlformat`

Add an optional `quality.format` task and `formatting.json` artifact:

- compare source with `qmlformat` output without editing files;
- pin/report the formatter version and `.qmlformat.ini` used;
- report file-level drift, not thousands of line findings;
- keep import sorting/normalization opt-in because it may change semantics.

### Compiler/build evidence

- Represent compiler-warning categories separately from ordinary lint warnings.
- Discover CMake QML modules and expected `*_qmllint`/`all_qmllint` targets where practical.
- Report module/type-information gaps rather than encouraging users to disable all missing-import/type checks.

### CI output

- Add SARIF output with stable fingerprints for GitHub/GitLab code-scanning interfaces.
- Add explicit CLI exit policies (`--fail-on block`, `--fail-on warn`, and incomplete-check handling).
- Print a concise tool-evidence table in markdown and summary output.

### Acceptance criteria

- Supported `qmllint` fixture formats normalize without dropping diagnostics.
- Formatting checks are deterministic under a pinned Qt version.
- SARIF locations, levels, rule help links, and fingerprints are valid.
- Tool absence, tool failure, malformed output, and incomplete imports are visibly distinct.

## Milestone 2 — Parser model and official-guidance rules

**Purpose:** implement high-value Qt guidance with enough semantic precision.

### Parser/model extensions

Add the minimum AST data needed for rules:

- property type, `required`, `readonly`, `default`, alias target, initializer, and source order;
- function parameter names/types and return type;
- signal parameters;
- import kind: Qt, Quickshell, KDE/Kirigami, local module, local directory, or JavaScript helper;
- object member kind/order and precise ranges;
- string literal ranges and the property/call in which they occur;
- parent layout/delegate/control relationships;
- assignments with owner/property resolution where possible.

Land each parser extension with malformed-input recovery tests before consuming it in rules.

### Rule set A: high-confidence semantics

1. **Precise layout ownership**
   - anchors on an immediate child managed by `RowLayout`, `ColumnLayout`, `GridLayout`, or `StackLayout`;
   - contradictory fill anchors and explicit geometry only, instead of all anchors plus any width/height;
   - distinguish a layout anchored to its non-layout parent, which is valid.
2. **Delegate state lifetime**
   - identify mutable state declared and changed inside disposable view/repeater delegates;
   - recommend model/backend state while excluding readonly/derived presentation state.
3. **Binding overwrite precision**
   - resolve imperative assignments more accurately;
   - distinguish intentional `Qt.binding()` replacement;
   - identify assignment sites and original binding sites.
4. **Component contracts**
   - report externally supplied data that should be `required` only when external dependence is demonstrable;
   - report broad `var` where a concrete type is inferable, while deferring to `qmllint` when available.
5. **Native style customization**
   - detect customized controls imported from native Windows/macOS styles;
   - avoid warning for cross-platform customizable styles.

### Rule set B: convention/advisory checks

- missing type annotations on non-trivial/reused QML functions;
- long inline JavaScript that should become a named function/helper;
- explicit signal-handler parameter syntax where legacy implicit parameters are used;
- component API leakage through aliases and deep `id` reach-through;
- object member ordering only when `qmlformat` is unavailable, and never as a blocking architecture issue.

### Acceptance criteria

- Every rule has positive, negative, malformed-input, suppression, and project-resolution tests.
- Every Qt-based rule links to the relevant Qt documentation in artifacts/SARIF.
- Official rules and lens advisories are visibly different in reports.
- Existing broad layout/image/Loader findings are either made precise, demoted, or renamed as heuristics.

## Milestone 3 — Test and runtime-warning evidence

**Purpose:** move from test-file discovery to correctness evidence.

### Work

1. Improve Qt Quick Test parsing:
   - `TestCase`, `SignalSpy`, `test_*`, `benchmark_*`, data functions, skipped/disabled cases;
   - test source roots and CMake/CTest registration where discoverable.
2. Add optional JUnit/CTest/qmltestrunner result ingestion.
3. Add a `test_evidence.json` artifact with run status, failures, duration, tool/version, and provenance.
4. Add opt-in runtime-warning log ingestion for:
   - binding loops;
   - failed object creation/imports;
   - invalid properties/handlers;
   - binding overwrite/removal messages;
   - scene-graph or image warnings.
5. Associate tests with components conservatively through direct imports/uses and explicit configuration.
6. Keep test coverage as an evidence map, not a simplistic “one test per QML file” rule.
7. Do not execute arbitrary applications, Quickshell configurations, or process-boundary code by default. Start with report ingestion; add curated offscreen execution only for explicitly configured test commands.

### Acceptance criteria

- A failing ingested Qt Quick Test result blocks when configured.
- Discovery-only and executed/passing are distinct states.
- Runtime reports retain command, Qt version, platform/plugin, and scenario provenance.
- Default analysis remains static, side-effect free, and dependency free.

## Milestone 4 — Accessibility, interaction, i18n, and theming

**Purpose:** cover production quality that complexity metrics cannot measure.

### Accessibility and input rules

Start as review findings and calibrate before allowing blocking:

- icon-only interactive controls without an accessible name/description;
- custom clickable/focusable items without keyboard activation;
- focus traps or popups/dialogs with no apparent Escape/close behavior;
- interactive items removed from the tab chain without a documented alternative;
- likely insufficient accessible role/name propagation in custom controls.

Use framework-aware type registries so Qt Quick Controls, Kirigami controls, and Quickshell shell surfaces are interpreted correctly.

### Internationalization rules

- detect likely user-facing `text`, `title`, `placeholderText`, `toolTip`, and accessibility strings not wrapped in a translation function;
- exclude object names, URLs, resource paths, debug logs, protocol strings, and explicitly marked non-translatable strings;
- detect common translation-function/context mismatches, preferring `qmllint` diagnostics where available.

### Theming/responsiveness rules

- semantic palette/token coverage rather than counting every color literal equally;
- fixed geometry in reusable controls and delegates, with exclusions for borders, icon sizes, and protocol-defined dimensions;
- native-style customization from Milestone 2;
- duplicate style groups that are candidates for shared controls/tokens.

### Acceptance criteria

- UX rules are advisory by default and include clear manual-review instructions.
- Each rule is tested against Qt Controls, Kirigami, and relevant Quickshell patterns before enabling the corresponding profile.
- Reports explicitly state that static checks cannot prove accessibility or visual correctness.

## Milestone 5 — Performance evidence and calibrated smells

**Purpose:** combine careful static review with measured runtime behavior.

### Recalibrate existing static rules

- `Image` without `sourceSize`: restrict to likely large/remote/dynamic images or make it a low-confidence review hint.
- `Loader` without `active`: report only when lazy/conditional intent is evident; otherwise remove the finding.
- delegate JavaScript: include object count, binding count, nested controls/layouts, images/effects, and model role computations rather than expression length alone.
- flag blocking/network/process work in handlers and bindings with framework-specific allowlists.
- identify frequently invalidated binding patterns only where dependency structure supports the claim.

### Runtime import

Perform a format spike before committing to an API. Then add a `runtime_performance.json` importer for supported QML Profiler/trace exports containing:

- scenario, hardware, Qt version, renderer, build type, and trace duration;
- frame-time percentiles and dropped frames;
- binding/handler/JavaScript count, total time, maximum time, and source location;
- object creation and compilation/startup time;
- JavaScript allocations/heap use;
- scene-graph timing, image/cache events, draw calls, overdraw, and texture memory when present.

Keep measured values separate from static estimates. Do not combine them into one opaque score.

### Acceptance criteria

- Runtime artifacts reject incompatible or provenance-free traces as incomplete.
- Static findings link to measured hotspots when locations match but remain independently inspectable.
- Performance budgets are configured per scenario/platform, never hard-coded globally.

## Milestone 6 — Framework profiles and ecosystem calibration

**Purpose:** achieve useful precision on real projects without making generic QML assumptions.

### Profiles

Provide composable profiles:

- `qtquick`: Qt Controls, layouts, modules, translation, and general lifecycle rules;
- `kirigami`: Kirigami controls, KDE conventions, palette/units, navigation patterns, and CI defaults;
- `quickshell`: Process/service boundaries, shell surfaces, popups, IPC, layer-shell, and side-effect safety;
- `custom`: project-defined type roles, boundary types, interaction controls, model types, and rule overrides.

Do not encode QGroundControl's domain architecture as generic QML rules; use it as a calibration project and as evidence that custom policy must be supported.

### Calibration program

1. Pin representative external repositories/commits in a benchmark manifest without vendoring their full source.
2. Run static-only analysis on Qt examples/`qtdeclarative`, Kirigami, QGroundControl, and Quickshell example configurations.
3. Sample findings by rule and label true positive, useful review, false positive, duplicate-of-tool, and cannot-determine.
4. Track precision/noise and parser/resolution coverage per rule and profile.
5. Disable or demote rules that do not meet the agreed noise budget.
6. Keep labeled synthetic fixtures for recall-oriented regression and real-project samples for precision/noise regression.
7. Publish calibration results with Qt/project revisions and analyzer version.

### Acceptance criteria

- No rule becomes a default blocker based only on synthetic positive fixtures.
- Blocker rules have no known false positives in the labeled negative corpus and pass representative-project review.
- Profile-specific findings do not appear when the profile/framework is absent.
- Calibration is reproducible and does not require runtime execution of untrusted project code.

## Implementation slices

The work was divided into focused changes:

1. **Finding metadata and rule registry** — types, serialization, registry validation, backward-compatible defaults.
2. **Audit policy fix** — include `qmllint`, add incomplete verdict, policy-based gating, regression tests.
3. **Tool provenance** — version/status/import confidence and robust `qmllint` format fixtures.
4. **Quality contract artifact** — dimension summaries and migration of the legacy score presentation.
5. **SARIF and explicit exit policy** — CI integration with stable fingerprints.
6. **`qmlformat` check task** — deterministic formatting evidence.
7. **Parser property/function metadata** — no new rules until recovery fixtures pass.
8. **Precise layout and binding-overwrite rules** — replace broad conflicts.
9. **Delegate lifetime and component-contract rules**.
10. **Test-result and runtime-warning ingestion**.
11. **Accessibility/i18n rules behind opt-in flags**.
12. **Static performance recalibration and runtime trace spike**.
13. **QtQuick/Kirigami/Quickshell profiles**.
14. **External corpus calibration and default-policy review**.

## Configuration evolution

The implemented configuration differs from early sketches in this plan. See the [README configuration reference](../README.md#config) and [`qmlqualitylens.schema.json`](../qmlqualitylens.schema.json) for current field names. Legacy `qmllint_report` and `qmllint_command` remain supported.

## Documentation deliverables

- rule reference generated from the rule registry;
- “What a pass means” and “What was skipped” documentation;
- CI recipes for CMake/Qt, GitHub Actions, GitLab CI, and Nix;
- profile guides for QtQuick, Kirigami, and Quickshell;
- artifact schema and migration notes;
- false-positive reporting and suppression guidance;
- calibration methodology and published benchmark snapshots.

## Success measures

Track these separately rather than optimizing the legacy score:

- percentage of analyzed QML files parsed without diagnostics;
- percentage of local imports/types resolved;
- percentage of configured tool runs with complete provenance;
- diagnostic normalization fidelity against Qt output fixtures;
- false-positive/useful-review rate by rule on the calibration corpus;
- duplicate rate between lens and `qmllint` findings;
- number of blocker, warning, review, and skipped checks;
- changed-code adoption: introduced findings fixed, suppressed with reasons, or accepted;
- test-result and runtime scenarios observed, not merely test files discovered;
- analysis runtime and memory on representative repository sizes.

Do not set arbitrary target percentages until the first external calibration establishes a baseline. For default blocker rules, require the strictest standard: no known false positive in the maintained negative corpus and successful review on representative projects.

## Remaining work

The trust-model foundation in Milestone 0 is complete. Remaining work is calibration-driven:

- deepen framework-specific interaction and boundary rules;
- improve malformed and uncommon QML recovery;
- add calibrated native QML Profiler adapters;
- continue representative-project labeling before strengthening default enforcement.

See the [roadmap](../ROADMAP.md) for the current list.
