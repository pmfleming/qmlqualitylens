# QML quality guidance and tools

This research snapshot covers Qt 6 QML/Qt Quick. It separates documented Qt guidance from conventions observed in major projects. Qt defines no universal QML quality score, file-size limit, or complexity threshold.

## Summary

Production-ready QML is:

1. **Correct and typed:** imports resolve, dependencies are explicit, and qmllint runs with the real import/type environment.
2. **Declarative:** bindings express state; imperative JavaScript is small and action-oriented.
3. **Separated:** QML owns presentation and interaction; durable state, I/O, large models, and substantial computation live in a backend/model.
4. **Lifecycle-safe:** disposable delegates do not own durable state, bindings are not accidentally overwritten, and dynamic objects are deliberate.
5. **Measured:** blocking work stays off the GUI thread, hot delegates and bindings remain cheap, and optimization follows profiler evidence.
6. **Usable:** layouts, keyboard/focus behavior, accessibility, translation, supported styles, tests, documentation, and licensing are addressed.

A strong project gate combines deterministic formatting, a correctly configured qmllint run, clean build/tests, no new runtime warnings, measured review of performance-sensitive changes, and changed-code gating for heuristics.

## Official sources

QML is part of Qt; there is no separate official “QML Foundation.” Primary authority is the [Qt Project](https://www.qt-project.org/) and [Qt documentation](https://doc.qt.io/qt-6/). Qt's conventions guide is guidance, not a complete contribution policy or quantitative quality model.

## Qt recommendations

### Structure and type safety

Qt's [QML Coding Conventions](https://doc.qt.io/qt-6/qml-codingconventions.html) and [Best Practices](https://doc.qt.io/qt-6/qtquick-bestpractices.html) recommend:

- order and group object members consistently;
- use grouped-property notation where clearer and one property per line;
- move multiline scripts into functions and long/reused scripts into JavaScript files;
- type JavaScript parameters/returns and prefer concrete properties over `var`;
- use `required`, `readonly`, and explicit dependencies to express contracts;
- qualify parent-component properties through an `id`;
- name signal-handler parameters with function/arrow syntax;
- prefer declarative bindings and review assignments that may replace them;
- use controls before building custom equivalents;
- keep durable state in models/backends rather than disposable delegates;
- keep substantial computation and large/dynamic data in a typed backend;
- make user-facing strings translatable from the start.

[`qmlformat`](https://doc.qt.io/qt-6/qtqml-tooling-qmlformat.html) applies Qt formatting conventions and supports `.qmlformat.ini`. Pin its version. Adopt import sorting deliberately because colliding module exports can make order significant.

### Components and layouts

Qt recommends CMake QML modules and bundled resources. `qt_add_qml_module()` compiles listed `QML_FILES`; moving those files away from their module can change implicit imports.

For layouts:

- size the layout relative to its non-layout parent;
- use `Layout.*` on immediate layout children;
- do not anchor an immediate layout child;
- avoid redundant preferred dimensions when implicit size is sufficient;
- keep hot delegates simple and design for varying size and DPI.

Do not customize native Windows/macOS Qt Quick Controls styles. Use a customizable style such as Basic, Fusion, Imagine, Material, or Universal, or provide a custom style.

### Performance

Qt's [QML performance guidance](https://doc.qt.io/qt-6/qtquick-performance.html) starts with profiling:

- keep the GUI thread event-driven and non-blocking;
- move substantial work to worker threads and avoid nested event loops;
- keep frequently reevaluated bindings simple;
- reduce repeated lookups and repeated bound-property updates;
- keep delegates cheap and create objects lazily when appropriate;
- size/load images appropriately;
- reduce unnecessary objects, updates, overdraw, animations, and scene-graph work.

About 16.7 ms corresponds to 60 Hz, not a universal budget. Targets depend on display refresh, hardware, product requirements, and GUI/render-thread work.

## Representative project expectations

These projects illustrate common and project-specific policy; they are not a statistical ranking.

### Qt Declarative

Qt's [contribution guide](https://github.com/qt/qtdeclarative/blob/dev/CONTRIBUTING.md), [general guidelines](https://wiki.qt.io/Qt_Contribution_Guidelines), and [commit policy](https://wiki.qt.io/Commit_Policy) emphasize Gerrit review, focused commits, successful builds/autotests, compatibility, documentation, translation, API review, and regression tests. Correctness and reviewability outweigh a numeric score.

### KDE Kirigami

Kirigami's [repository and CI](https://github.com/KDE/kirigami) and KDE's [commit policy](https://community.kde.org/Policies/Commit_Policy) require broad build/test coverage, qmllint, static analysis, atomic understood changes, review, compatibility, and SPDX metadata. Its qmllint policy includes unqualified access, imports/types, required properties, incompatible types, duplicate bindings, and handler parameters.

### QGroundControl

QGroundControl's [contribution guide](https://github.com/mavlink/qgroundcontrol/blob/master/.github/CONTRIBUTING.md) and repository configurations require documented formatting, qmllint, focused changes, tests/CI, UI evidence, platform testing, and architecture conventions. Disabled qmllint categories also demonstrate an important limitation: custom modules/context properties can make evidence incomplete unless the real type environment is available.

### Quickshell

Quickshell's [contribution policy](https://git.outfoxxed.me/quickshell/quickshell/src/branch/master/CONTRIBUTING.md) requires human responsibility for every change, focused license-compatible commits, project formatting/linting, tests where appropriate, documentation, and changelog entries. It explicitly prohibits unsupervised automated submissions. A tool can support human review but cannot certify contributor responsibility.

## Common contribution baseline

Across these projects:

1. Read local policy; project rules override generic advice.
2. Keep changes focused and avoid unrelated formatting churn.
3. Build against supported Qt versions/configurations.
4. Use the project's formatter and qmllint environment.
5. Add and run relevant unit, integration, and UI tests.
6. Check runtime warnings and visually inspect UI changes.
7. Review keyboard/focus, translation, DPI/resizing, themes, and platforms.
8. Profile startup, delegates, animation, models, images, and rendering when affected.
9. Update public documentation, screenshots, release notes, and translations.
10. Satisfy licensing, contribution agreements, review, and CI.

Numeric size or complexity values are useful hotspot policies, not common standards.

## Tools

| Tool | Evidence | Best use |
| --- | --- | --- |
| [`qmllint`](https://doc.qt.io/qt-6/qtqml-tooling-qmllint.html) | Syntax, imports/types, handlers, type safety, deprecations, compiler warnings, JSON output | Primary static correctness gate |
| [`qmlformat`](https://doc.qt.io/qt-6/qtqml-tooling-qmlformat.html) | Deterministic Qt formatting | Pinned style enforcement |
| [`qmlls`](https://doc.qt.io/qt-6/qtqml-tooling-qmlls.html) | Diagnostics, completion, navigation, references, rename | Fast editor feedback with correct build/import setup |
| Qt Quick Compiler / `qmlcachegen` / `qmlsc` | Compilation compatibility and blockers | Build-time compatibility/performance evidence |
| [Qt Quick Test](https://doc.qt.io/qt-6/qtquicktest-index.html) | QML unit, interaction, data-driven, and signal tests | Behavioral regression gate |
| [QML Profiler](https://doc.qt.io/qtcreator/creator-qml-performance-monitor.html) | Binding, JavaScript, creation, frame, image, memory, and scene-graph events | Runtime measurement on representative workloads |
| Scene-graph timing/visualization | Render/sync/upload timing, batches, clipping, overdraw | Rendering diagnosis |
| [GammaRay](https://github.com/KDAB/GammaRay) | Runtime object/item trees, properties, bindings, layouts, signals | Runtime structure and state diagnosis |
| [Squish for Qt](https://doc.qt.io/squish/) | Cross-platform GUI automation | End-to-end UI regression testing |
| Sanitizers, Valgrind, general profilers | Backend correctness, memory, races, native hotspots | Mixed C++/QML quality |
| `clazy`, `clang-tidy`, `clang-format` | Qt/C++ API and style checks | Types/models exposed to QML |
| [`qmlqualitylens`](../README.md) | QML architecture, complexity, locality, clones, cleanup, semantics, and changed-code artifacts | Review prioritization beyond qmllint |

### Limitations

- qmllint needs complete type information and correct import/build paths.
- qmlformat checks layout, not architecture or behavior.
- profiler evidence covers only executed scenarios and environments.
- generic JavaScript tools rarely model embedded QML scope correctly.
- generic metrics do not replace QML type, binding, lifecycle, or runtime analysis.
- static analysis cannot prove visual correctness, accessibility, usability, or frame stability.

## Recommended evidence model

**Potential gates:** parser errors, configured qmllint diagnostics, known-complete local resolution failures, proven semantic conflicts, failing tests, new runtime warnings, and configured build/license failures.

**Review signals:** size, complexity, coupling, API surface, clones, cleanup, delegate weight, lazy loading, image sizing, style literals, accessibility, keyboard behavior, translation, and theming.

**Separate runtime evidence:** frame percentiles, dropped frames, binding/handler timing, object creation, startup, JavaScript memory, images/cache, draw calls, overdraw, and full environment/scenario provenance.

Never merge measured and inferred values without preserving which claims were observed, inferred, skipped, or environment-dependent.

## Suggested CI baseline

```sh
cmake --build build --target all_qmllint
ctest --test-dir build --output-on-failure
npm run build
node dist/bin/qmlqualitylens.js audit \
  --config qmlqualitylens.config.json \
  --base origin/main --format markdown
```

Version `.qmllint.ini`, `.qmlformat.ini`, import paths, build directories, and warning policy. Gate introduced findings first, then reduce existing debt without unrelated churn.

## Primary sources

- [Qt: QML Coding Conventions](https://doc.qt.io/qt-6/qml-codingconventions.html)
- [Qt: Best Practices for QML and Qt Quick](https://doc.qt.io/qt-6/qtquick-bestpractices.html)
- [Qt: QML Performance](https://doc.qt.io/qt-6/qtquick-performance.html)
- [Qt: Qt Quick Tools](https://doc.qt.io/qt-6/qtquick-tools-and-utilities.html)
- [Qt: qmllint](https://doc.qt.io/qt-6/qtqml-tooling-qmllint.html)
- [Qt: qmlformat](https://doc.qt.io/qt-6/qtqml-tooling-qmlformat.html)
- [Qt: QML Language Server](https://doc.qt.io/qt-6/qtqml-tooling-qmlls.html)
- [Qt: Qt Quick Test](https://doc.qt.io/qt-6/qtquicktest-index.html)
- [Qt Creator: QML profiling](https://doc.qt.io/qtcreator/creator-qml-performance-monitor.html)
- [Qt Project: Contribution Guidelines](https://wiki.qt.io/Qt_Contribution_Guidelines)
- [Qt Project: Commit Policy](https://wiki.qt.io/Commit_Policy)
- [KDE: Commit Policy](https://community.kde.org/Policies/Commit_Policy)
- [KDE Kirigami](https://github.com/KDE/kirigami)
- [QGroundControl contribution guide](https://github.com/mavlink/qgroundcontrol/blob/master/.github/CONTRIBUTING.md)
- [Quickshell contribution policy](https://git.outfoxxed.me/quickshell/quickshell/src/branch/master/CONTRIBUTING.md)
