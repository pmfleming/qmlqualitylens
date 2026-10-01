# Static semantic completeness (Trust T3)

Completeness is a claim about **declared static evidence**, never arbitrary application behavior. Resolution cannot be inferred from a lack of findings. Runtime behavior, externally consumed APIs and independently calibrated rankings retain their separate acceptance obligations.

`src/rule-prerequisites.ts` inventories every generic QML rule. Tests require the inventory to match executed rule coverage exactly. All require successful QML parsing; additionally:

| Rule family | Required evidence |
| --- | --- |
| Layout, native style, accessibility, image/Loader patterns | Resolved file imports/types and usable configured type metadata; external inheritance cannot be guessed |
| Delegate state / delegate complexity | The above plus inspected executable expressions |
| Process-command construction | Resolved imports/types and inspected expressions |
| Missing required declaration | Resolved project relationships, not an incomplete set of users |
| Quickshell process placement | Resolved file imports/types |
| Typed-property literals, function annotations, untranslated-string patterns, API/alias/binding counts | Parsed declaration/syntax patterns only; unrelated semantic gaps do not invalidate these counts |

The seven specialized rules have execution-derived coverage:

- **Binding loss:** scoped local assignment owner and member, inspectable binding initializer; dynamic writes, unknown inherited members/owners and indirect initializer dependencies abstain. This checks direct parsed assignments, not effects hidden in external function bodies.
- **Binding cycles:** direct local dependency graph only. Opaque calls, closures, imported dependencies and unresolved owners/members abstain rather than certify absence of a cycle.
- **Connections unknown target:** local ID scope; dynamic and singleton targets abstain.
- **Connections signal mismatch:** known signals can confirm a handler. Absence requires a complete configured signal hierarchy. Builtin role metadata is not an exhaustive Qt signal database. Missing, ambiguous or cyclic inheritance never proves a mismatch.
- **Side effects in bindings:** an unshadowed `Qt.openUrlExternally` call is a blocking diagnostic. Names such as `exec`/`spawn` alone do not establish side effects. Unknown calls, deferred bodies, shadowed/imported globals, state assignments and dynamic property access abstain. Value-only builtin calls accept primitive arguments; arbitrary object coercion may invoke user hooks and remains unknown. Event handlers are not declarative value bindings.
- **Unused public property/signal:** unresolved reads/calls in analyzed consumers propagate to their consumed/inherited component APIs. Ambiguous consumer behavior cannot prove an API unused. Only resolved, analyzed consumers are modeled; absence of external consumers is not established.

Targets with unmet prerequisites are `skipped`, with reasons, rather than `evaluated` negatives. Required/blocking rule skips become incomplete checks in both audit and quality contract. With `--incomplete fail`, these checks fail independently of ordinary finding suppression. The default incomplete=warn policy can still return exit 0; that is not a completeness certificate.

Function **and binding** complexity retain backend/complete metadata. Aggregate confidence includes approximate metrics, parser/resolution gaps, configured type metadata failures and rule abstentions. Hotspot maxima expose `complexity_complete`. Counts and ranking remain advisory. Missing optional Tree-sitter does not become complete numerical evidence just because a lexical estimate exists.

Unknown-type declarations and duplicate unqualified project type names are not repaired by merging their member sets. Ambiguous type metadata is partial. This does not claim a new fully module-qualified type system (P2 remains separate).

## Compatibility notes

The stricter model intentionally reports more abstentions and fewer findings on Shelllist. In particular, opaque qualified singleton calls and computed consumer reads can prevent removal recommendations. Direct typed casts remain supported, but a cast is not a waiver for an unresolved computed read. Existing positive/negative regression labels remain unchanged; the signal-mismatch fixture now supplies explicit signal metadata, and the blocking reporter fixture calls a known Qt API rather than an ambiguous function name.

Use native Qt evidence to complement abstentions. Do not hide them by expanding allowlists, disabling checks or labeling unfamiliar code clean.
