# QML code quality: official guidance, project expectations, and tools

This is a research snapshot for **Qt 6 QML/Qt Quick**. It separates documented Qt guidance from conventions inferred from major projects. That distinction matters: there is no universal QML quality score or official maximum file size, object count, binding complexity, or cyclomatic-complexity threshold.

## Executive summary

High-quality QML is:

1. **Correct and statically understandable**: imports and types resolve, properties and functions are typed, dependencies are explicit, and `qmllint` is clean with the project's real import paths.
2. **Declarative**: bindings express state relationships; imperative JavaScript is reserved for actions and is kept small.
3. **Architecturally separated**: QML owns presentation and interaction, while durable state, large models, I/O, and substantial computation live in an appropriate backend/model.
4. **Lifecycle-safe**: state is not stored in disposable delegates, bindings are not accidentally overwritten, and dynamic objects are controlled deliberately.
5. **Responsive and measured**: delegates and bindings are cheap, blocking work does not run on the GUI thread, and optimization follows QML Profiler evidence.
6. **Usable in production**: responsive layouts, keyboard/focus behavior, accessibility, translation, supported styles, tests, documentation, and license hygiene are included.

A strong default project gate is:

- deterministic formatting;
- zero `qmllint` errors and no unexplained warnings;
- compiler-warning checks where the supported Qt version makes them reliable;
- a clean build and relevant automated tests;
- no new runtime QML warnings during smoke tests;
- profiling and UI review for performance-sensitive changes;
- changed-code gating for heuristic maintainability findings.

## Who publishes the official guidance?

No official QML standards organization commonly known as the **“QML Foundation”** was identified. QML is developed as part of Qt. The primary sources are the [Qt Project](https://www.qt-project.org/) and the [Qt documentation](https://doc.qt.io/qt-6/).

The official conventions page says that its rules are followed in Qt documentation and examples and are recommended for others. They are recommendations, not a complete contribution policy and not a quantitative quality model.

## Official Qt recommendations

### Structure and formatting

Qt's [QML Coding Conventions](https://doc.qt.io/qt-6/qml-codingconventions.html) recommend:

- order object content as `id`, property declarations, signal declarations, JavaScript functions, object properties, then child objects;
- separate those sections with blank lines and group related properties;
- use grouped-property notation when it improves readability;
- put each property on its own line;
- use blocks for multiline script expressions and semicolons inside script blocks;
- move scripts longer than a few lines into a function; move long/reused scripts into a JavaScript file;
- add parameter and return type annotations to JavaScript functions;
- explicitly qualify a parent component's properties through its `id`;
- name signal-handler parameters explicitly, using function/arrow-function syntax;
- use `required` properties for data that must be supplied externally.

[`qmlformat`](https://doc.qt.io/qt-6/qtqml-tooling-qmlformat.html) is Qt's formatter for these conventions. Its defaults include four-space indentation. It can be configured through `.qmlformat.ini`. Reordering or sorting imports must be adopted deliberately because import sorting can alter semantics where modules export colliding type names.

### Declarative design and type safety

Qt's [Best Practices for QML and Qt Quick](https://doc.qt.io/qt-6/qtquick-bestpractices.html) recommend:

- prefer built-in Qt Quick Controls before implementing a custom control;
- prefer declarative bindings over imperative assignments;
- use concrete property types instead of `var` whenever possible;
- use `required` properties and explicit dependencies instead of ambient/unqualified context lookup;
- keep C++ types unaware of QML where possible and push backend references/data into QML;
- use QML for presentation and interaction, and a strongly typed backend for substantial computation or large/dynamic data sets;
- keep durable state in models, not delegates, because delegates can be destroyed and recreated;
- prefer explicit user-interaction signals such as `Slider.moved` over generic value-change signals when sending user changes back to a backend;
- make user-facing strings translatable from the beginning.

Practical implications:

- typed, `required`, and `readonly` properties communicate component contracts;
- a component should have a small public API and avoid reaching deeply through unrelated `id` objects;
- assignments in handlers deserve review if the target normally has a declarative binding, because an assignment can remove that binding;
- a model or backend should be the source of truth; the visual tree should not become an implicit data store.

### Components, resources, and layouts

Qt recommends using CMake QML modules and bundling resources. With `qt_add_qml_module()`, QML files listed in `QML_FILES` are compiled ahead of time. Qt warns that QML files should normally be in the same directory as the module's `CMakeLists.txt`; otherwise implicit imports can differ from the module to which the files belong.

For layout code:

- size a layout relative to its non-layout parent with anchors or width/height;
- use `Layout.*` properties on a layout's immediate children;
- do not put anchors on an immediate child of a layout;
- do not specify preferred dimensions when a satisfactory implicit size already exists;
- avoid unnecessary layouts/anchors in hot delegates when simple geometry bindings suffice;
- design for varying sizes and DPI rather than fixed pixels everywhere.

For Qt Quick Controls, Qt warns not to customize native Windows/macOS styles. Base customized controls on a cross-platform customizable style such as Basic, Fusion, Imagine, Material, or Universal, or provide a custom style.

### Performance

Qt's [QML Performance Considerations and Suggestions](https://doc.qt.io/qt-6/qtquick-performance.html) starts with profiling rather than speculative optimization. Its main guidance includes:

- keep the GUI thread event-driven and non-blocking;
- do substantial work in worker threads;
- never spin/process a nested event loop to disguise blocking work;
- keep frequently reevaluated bindings simple;
- avoid repeated property and value-type lookups in hot code;
- aggregate changes in a temporary value instead of repeatedly changing a bound property in a loop;
- keep delegates simple and create objects lazily where appropriate;
- size images appropriately and use asynchronous loading where appropriate;
- reduce unnecessary object creation, invisible-item updates, overdraw, animations, and scene-graph work.

“60 FPS” implies about 16.7 ms per frame, but it is not a universal pass/fail threshold. The target depends on hardware, display refresh rate, product requirements, and the work shared between GUI and render threads.

## What major QML projects require

The projects below are representative, not a statistically ranked list of the largest repositories. Their policies demonstrate the common contribution baseline and project-specific differences.

### Qt Declarative / Qt itself

Qt's [`qtdeclarative` contribution file](https://github.com/qt/qtdeclarative/blob/dev/CONTRIBUTING.md), [Contribution Guidelines](https://wiki.qt.io/Qt_Contribution_Guidelines), and [Commit Policy](https://wiki.qt.io/Commit_Policy) require or expect:

- contributions through Qt Gerrit, not GitHub pull requests;
- a Qt account, correctly configured authorship, and compliance with the contribution agreement;
- a developer build and successful Qt build/autotest integration;
- one self-contained change per commit and no unrelated formatting cleanup;
- Qt coding conventions, API design review, documentation, translation conventions, and no reliance on private APIs;
- tests for fixed bugs and new functionality, or an explicit reason why an automated test is not possible;
- no regressions and compatibility with supported platforms/configurations;
- response to Early Warning System, reviewer, and CI feedback;
- a ChangeLog entry for significant user-facing or compatibility changes.

This is the canonical upstream bar: correctness, reviewability, compatibility, documentation, and tests are more important than a numeric maintainability score.

### KDE Kirigami

Kirigami's [CI configuration](https://github.com/KDE/kirigami/blob/master/.kde-ci.yml), [GitLab CI configuration](https://github.com/KDE/kirigami/blob/master/.gitlab-ci.yml), [`qmllint` configuration](https://github.com/KDE/kirigami/blob/master/qmllint.ini.in), and KDE's [Commit Policy](https://community.kde.org/Policies/Commit_Policy) show a framework-level gate:

- run tests before installation and require passing tests on Linux, FreeBSD, and Windows;
- build/test additional configurations including Qt-next, static builds, and Android;
- run `qmllint`, with warnings including unqualified access, unused imports, missing properties/types, incompatible types, required properties, duplicate bindings, and signal-handler parameters;
- run C++ static analysis and XML/YAML linting;
- use atomic commits, avoid mixing formatting with behavior, test before submission, and do not submit code the author does not understand;
- include SPDX license/copyright metadata and follow KDE review and compatibility policies.

### QGroundControl

QGroundControl is a large production Qt/QML application. Its [contribution guide](https://github.com/mavlink/qgroundcontrol/blob/master/.github/CONTRIBUTING.md), [coding style](https://github.com/mavlink/qgroundcontrol/blob/master/CODING_STYLE.md), [`qmllint` settings](https://github.com/mavlink/qgroundcontrol/blob/master/.qmllint.ini), [`qmlformat` settings](https://github.com/mavlink/qgroundcontrol/blob/master/.qmlformat.ini), and [pre-commit configuration](https://github.com/mavlink/qgroundcontrol/blob/master/.pre-commit-config.yaml) expect:

- four-space, LF, UTF-8 QML with a documented object-content order;
- `qmlformat` normalization and `qmllint` in the local lint gate;
- explicit Qt 6 signal/`Connections` function syntax and project architecture conventions;
- `just build`, `just lint`, and relevant tests before completion;
- unit tests for new behavior, all CI checks passing, focused changes, documentation, and screenshots for UI changes;
- testing on applicable desktop/mobile platforms and PX4/ArduPilot configurations;
- Conventional Commits and compatibility with its Apache-2.0/GPL-3.0 dual-license policy.

Its configuration also illustrates an important limitation: projects sometimes disable valid `qmllint` categories when their custom modules or context properties are not fully visible to the tool. A quality report must distinguish a clean result from an incomplete type/import environment.

### Quickshell

Quickshell is especially relevant to this repository's intended users. Its [contribution policy](https://git.outfoxxed.me/quickshell/quickshell/src/branch/master/CONTRIBUTING.md) and [development guide](https://git.outfoxxed.me/quickshell/quickshell/src/branch/master/HACKING.md) require:

- the submitter to understand and take responsibility for every change;
- human-submitted changes; automated tooling or AI-agent submissions without a human in the loop are explicitly prohibited;
- license-compatible, focused, stand-alone changes;
- formatting with `just fmt` and linting changed code with the documented test-enabled build configuration;
- no regression in existing tests and tests for complex/breakable features when requested;
- source documentation and a changelog entry for user-visible changes;
- project-specific scoped commit messages and a clean, searchable history.

A tool can assist a human review, but it cannot certify compliance with contributor-responsibility policies.

## Industry common denominator

Across these projects, contribution-ready QML normally means:

1. Read the repository's local policy; existing project style takes precedence over generic advice.
2. Keep the change focused and avoid unrelated formatting or generated-file churn.
3. Build against the project's supported Qt version and configurations.
4. Run its exact formatter and linter configuration with correct import/build paths.
5. Add or update tests and run relevant unit, integration, and UI tests.
6. Check runtime QML warnings and visually inspect UI changes.
7. Test keyboard/focus, localization, resizing/DPI, themes/styles, and applicable platforms.
8. Profile changes to delegates, startup, animations, large models, images, or rendering.
9. Update public API documentation, screenshots, release notes/changelog, and translations as required.
10. Satisfy license headers, contribution agreements, review feedback, and CI.

There is no evidence of a common industry gate such as “QML files must be below 250 lines” or “binding complexity must be below 5.” Such values are useful hotspot heuristics, not standards violations.

## Tools that can measure or enforce QML quality

| Tool | What it provides | Appropriate use |
| --- | --- | --- |
| [`qmllint`](https://doc.qt.io/qt-6/qtqml-tooling-qmllint.html) | Syntax, imports/types, handlers, unqualified access, duplicate bindings, deprecations, type safety, anti-patterns, optional compiler warnings; JSON output | Primary static correctness gate |
| [`qmlformat`](https://doc.qt.io/qt-6/qtqml-tooling-qmlformat.html) | Deterministic Qt-convention formatting | Style enforcement; compare generated output in CI if the installed version has no check mode |
| [`qmlls`](https://doc.qt.io/qt-6/qtqml-tooling-qmlls.html) | Editor diagnostics from `qmllint`, completion, navigation, references, rename, formatting | Fast developer feedback; requires correct build/import configuration |
| Qt Quick Compiler / `qmlcachegen` / `qmlsc` diagnostics | Whether QML can be compiled efficiently and which constructs block compilation | Build-time compatibility/performance signal; enable the `qmllint` compiler warning category deliberately |
| [Qt Quick Test](https://doc.qt.io/qt-6/qtquicktest-index.html) / `qmltestrunner` | QML unit and interaction tests, `TestCase`, `SignalSpy`, data-driven tests | Behavior and regression gate, commonly run offscreen in CI |
| [QML Profiler](https://doc.qt.io/qtcreator/creator-qml-performance-monitor.html) | Binding/handler/JavaScript time and frequency, object creation, compilation, animation FPS, pixmap cache, JS memory, scene-graph events | Runtime performance measurement on representative hardware/workloads |
| `QSG_RENDER_TIMING`, scene-graph visualization modes | Render/sync/upload timing, batches, clipping, overdraw, dirty regions | Rendering diagnosis and frame-budget work |
| [GammaRay](https://github.com/KDAB/GammaRay) | Runtime QObject/item trees, properties, bindings, scene graph, layouts, signals, and other introspection | Diagnose object growth, wrong bindings, layout/item-tree problems, and runtime state |
| [Squish for Qt](https://doc.qt.io/squish/) | Automated cross-platform GUI interaction and verification | End-to-end UI regression testing |
| Qt Test, sanitizers, Valgrind, general profilers | Backend correctness, leaks, races, C++ hot paths | Necessary for mixed C++/QML applications; QML Profiler does not replace C++ analysis |
| `clazy`, `clang-tidy`, `clang-format` | Qt/C++ API misuse, C++ static analysis, C++ style | Quality of types and models exposed to QML, not QML source itself |
| [`qmlqualitylens`](../README.md) | Heuristic architecture, complexity, locality, clone, cleanup, semantic, test-catalog, and changed-code artifacts | Review prioritization beyond `qmllint`; not an official Qt validator |

### Tool limitations

- `qmllint` quality depends on complete QML type information and correct import/build paths. Missing modules create false positives; disabling import/type warnings can hide real defects.
- `qmlformat` enforces layout, not architecture or behavior. Pin the Qt/tool version to avoid formatter drift.
- QML Profiler measures executed paths only. A clean trace does not cover unloaded components, other states, other devices, or rare input paths.
- General JavaScript linters and complexity tools usually do not parse embedded QML JavaScript with QML scope/type semantics correctly.
- Generic Sonar-style code metrics do not replace QML-aware type resolution, binding analysis, lifecycle checks, or runtime profiling.
- A static score cannot prove visual correctness, accessibility, usability, or frame-time stability.

## Recommended quality model for qmlqualitylens

The lens should report separate evidence dimensions rather than imply that one score defines “best QML.”

### Hard or high-confidence gates

- parser/syntax errors;
- `qmllint` errors and configured warning policy;
- unresolved local imports/types when the import environment is known complete;
- duplicate assignments/bindings, binding cycles, and invalid signal handlers;
- anchors on immediate layout children and other unambiguous layout conflicts;
- failing tests and newly introduced runtime QML warnings;
- license/build/configuration failures when those inputs are available.

### Review-required findings

- file SLOC, object count, handler/function complexity, nesting, and large bindings;
- cross-object `id` coupling and long property reach-through;
- component fan-out, low reuse, clones, and unused API/components;
- delegate weight, Loader policy, image sizing, hardcoded visual values, and side-effect placement;
- accessibility, keyboard navigation, translation, and theming heuristics.

These are hotspot signals. They need project-specific thresholds, suppressions with reasons, and changed-code baselines; they should not be presented as Qt rules.

### Runtime evidence to add separately

If runtime import is added later, retain raw provenance and report:

- frame-time percentiles and dropped frames, not only average FPS;
- binding/handler count, total time, maximum time, and callers/callees;
- object creation and startup/loading time;
- JavaScript heap allocation/usage;
- image decode/cache cost, draw calls, texture/mesh memory, and overdraw;
- hardware, Qt version, renderer, build type, scenario, and trace duration.

Do not merge static and runtime data without preserving which claims are measured, inferred, skipped, or environment-dependent.

## Suggested CI baseline

For a modern CMake Qt 6 project:

```sh
# Generated by qt_add_qml_module() when linting is enabled
cmake --build build --target all_qmllint

# Project tests
ctest --test-dir build --output-on-failure

# Formatting: qmlformat has version-dependent options; a portable check writes
# formatted output to a temporary file and compares it without changing sources.
qmlformat path/to/File.qml > /tmp/File.qml.formatted
diff -u path/to/File.qml /tmp/File.qml.formatted

# This project
npm run build
node dist/bin/qmlqualitylens.js audit \
  --config qmlqualitylens.config.json \
  --base origin/main \
  --format markdown
```

Configure `.qmllint.ini`, `.qmlformat.ini`, import paths, build directories, and warning severities in version control. Prefer failing on newly introduced findings first; ratchet existing debt down rather than requiring a noisy repository-wide cleanup in an unrelated change.

## Primary sources

- [Qt: QML Coding Conventions](https://doc.qt.io/qt-6/qml-codingconventions.html)
- [Qt: Best Practices for QML and Qt Quick](https://doc.qt.io/qt-6/qtquick-bestpractices.html)
- [Qt: QML Performance Considerations and Suggestions](https://doc.qt.io/qt-6/qtquick-performance.html)
- [Qt: Qt Quick Tools and Utilities](https://doc.qt.io/qt-6/qtquick-tools-and-utilities.html)
- [Qt: `qmllint`](https://doc.qt.io/qt-6/qtqml-tooling-qmllint.html)
- [Qt: `qmlformat`](https://doc.qt.io/qt-6/qtqml-tooling-qmlformat.html)
- [Qt: QML Language Server](https://doc.qt.io/qt-6/qtqml-tooling-qmlls.html)
- [Qt: Qt Quick Test](https://doc.qt.io/qt-6/qtquicktest-index.html)
- [Qt Creator: Profiling QML applications](https://doc.qt.io/qtcreator/creator-qml-performance-monitor.html)
- [Qt Project: Contribution Guidelines](https://wiki.qt.io/Qt_Contribution_Guidelines)
- [Qt Project: Commit Policy](https://wiki.qt.io/Commit_Policy)
- [KDE: Commit Policy](https://community.kde.org/Policies/Commit_Policy)
- [KDE Kirigami repository and CI policy](https://github.com/KDE/kirigami)
- [QGroundControl contribution guide](https://github.com/mavlink/qgroundcontrol/blob/master/.github/CONTRIBUTING.md)
- [Quickshell contribution policy](https://git.outfoxxed.me/quickshell/quickshell/src/branch/master/CONTRIBUTING.md)
