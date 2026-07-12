# Table Validation Engine — Browser JS Implementation Specification

## Document Version: 1.2.0

> **Document set.** This document defines the **Browser JS profile** of the *Table Validation Library — Core Specification v1.2.0* (the "Core Spec") and of its *Authoring, Ingestion & Inference Addendum v1.2.0* (the "Addendum", Core Spec §16). All validation and comparison behavior — pipeline, rules, semantics, result structure — is defined there and is not restated here. This document binds the host capabilities of Core Spec §1.6, defines the concrete public API (validation, comparison, and the tooling modules), and specifies packaging and CDN publishing. The doc version, `TableValidation.VERSION`, `TableValidation.SPEC_VERSION`, and the `specVersion` field emitted in every result share **one unified number** (§7.3).

An implementation is conformant to this profile iff it (a) satisfies every normative requirement of the Core Spec v1.2.0, (b) exposes the API and bindings defined here, and (c) binds all three optional modules of the Addendum (`authoring`, `ingestion`, `inference` — Addendum §D) via §3.11–§3.13. The published artifact `dist/table-validation.js` implements this profile in full (§7.3).

---

## Table of Contents

- [1. Scope & Runtime Requirements](#1-scope--runtime-requirements)
- [2. Distribution Artifacts & Loading](#2-distribution-artifacts--loading)
- [3. Public API](#3-public-api)
  - [3.1 Result Model: Severity & Termination](#31-result-model-severity--termination)
  - [3.2 `TableValidation.validate`](#32-tablevalidationvalidate)
  - [3.3 `TableValidation.compare`](#33-tablevalidationcompare)
  - [3.4 `TableValidation.buildReport`](#34-tablevalidationbuildreport)
  - [3.5 `TableValidation.renderMessage`](#35-tablevalidationrendermessage)
  - [3.6 `TableValidation.exportXlsx`](#36-tablevalidationexportxlsx)
  - [3.7 `TableValidation.exportComparisonXlsx`](#37-tablevalidationexportcomparisonxlsx)
  - [3.8 `TableValidation.exportAnnotatedXlsx`](#38-tablevalidationexportannotatedxlsx)
  - [3.9 Input Adapters](#39-input-adapters)
  - [3.10 Constants & Errors](#310-constants--errors)
  - [3.11 Config Meta-Model & Builder](#311-config-meta-model--builder)
  - [3.12 `TableValidation.ingest`](#312-tablevalidationingest)
  - [3.13 `TableValidation.inferConfig`](#313-tablevalidationinferconfig)
  - [3.14 Worker Wrapper & Message Protocol](#314-worker-wrapper--message-protocol)
- [4. Host Capability Bindings](#4-host-capability-bindings)
  - [4.1 Regex Engine](#41-regex-engine)
  - [4.2 Temporal Engine (Luxon)](#42-temporal-engine-luxon)
  - [4.3 Custom Function Registry](#43-custom-function-registry)
  - [4.4 Number & Boolean Parsing](#44-number--boolean-parsing)
  - [4.5 Spreadsheet Writer (ExcelJS)](#45-spreadsheet-writer-exceljs)
  - [4.6 Fuzzy Metrics (comparison)](#46-fuzzy-metrics-comparison)
  - [4.7 Tolerance Function Registry (comparison)](#47-tolerance-function-registry-comparison)
  - [4.8 Ingestion Bindings (TextDecoder, ExcelJS reader)](#48-ingestion-bindings-textdecoder-exceljs-reader)
- [5. Implementation Notes](#5-implementation-notes)
- [6. Repository Layout (no build step)](#6-repository-layout-no-build-step)
- [7. CDN Publishing](#7-cdn-publishing)
  - [7.1 Route A: GitHub → jsDelivr (recommended — no toolchain required)](#71-route-a-github--jsdelivr-recommended--no-toolchain-required)
  - [7.2 Route B: npm → jsDelivr / unpkg (alternative; requires npm)](#72-route-b-npm--jsdelivr--unpkg-alternative-requires-npm)
  - [7.3 Versioning & Pinning Policy](#73-versioning--pinning-policy)
  - [7.4 Subresource Integrity](#74-subresource-integrity)
- [8. Usage Examples](#8-usage-examples)
- [9. Conformance Testing](#9-conformance-testing)
- [10. Non-Goals](#10-non-goals)

---

## 1. Scope & Runtime Requirements

- **Target**: in-browser use via `<script>` tags served from a CDN. No bundler, no build step for consumers. **Node.js ≥ 20 is an officially supported second runtime** (below).
- **Language level**: ECMAScript 2020+. Reference environments: current versions of Chrome, Firefox, Edge, Safari; Node ≥ 20.
- **Module format**: a single IIFE bundle exposing one global, `TableValidation`. No ESM/CJS entry points are specified in this version (see [§10](#10-non-goals)).
- **Node.js support**: the artifact reads only `globalThis`, so evaluating `dist/table-validation.js` in Node (e.g. `require('vm').runInThisContext(fs.readFileSync(...))`, or a `<script>`-equivalent loader) installs the same `TableValidation` global with the full API. Requirements: Node ≥ 20 (`Blob`, `TextDecoder`, `fetch`, structured clone are platform-provided); Luxon and ExcelJS are installed/loaded **by the consumer** exactly as in the browser — any mechanism that leaves `globalThis.luxon` / `globalThis.ExcelJS` set works (npm packages, or the same browser bundles). The full conformance corpus runs in Node via [`test/node-runner.js`](test/node-runner.js) (plain Node, no npm project), which is a release gate alongside the browser suite.
- **Dependencies** (loaded by the consumer as separate globals, never bundled):

| Dependency | Global | Required for | Version |
|---|---|---|---|
| Luxon | `luxon` | all validation/comparison involving `datetime`/`date`/`time` columns, `T+/-N`, timezone handling; the inference temporal ladder (`inferConfig`, §3.13 — absent Luxon skips ladder step 5 and reports it); authoring-time IANA-zone checking (§3.11 — absent Luxon defers rule 4); the `reformatTemporal` normalization built-in (§3.12 — a thrown `TableValidationConfigError` only when a spec actually uses it) | 3.x |
| ExcelJS | `ExcelJS` | the three exporters (`exportXlsx`, `exportComparisonXlsx`, `exportAnnotatedXlsx`) **and XLSX ingestion** (`ingest` with `format: "xlsx"`, §3.12 — the reader side, §4.8) | 4.x |

The engine core (structure checks, string/int/float/bool/categorical columns, and the comparison pairing/outcome logic — including the native-JS fuzzy metrics of §4.6) MUST work with neither dependency present, as do the builder (§3.11), CSV/TSV/JSON ingestion (§3.12), and the non-temporal inference ladder (§3.13). Dependency presence is checked lazily: a missing `luxon` global is a thrown `TableValidationConfigError` only when a schema actually requires temporal evaluation; a missing `ExcelJS` global only when one of the exporters — or `ingest` with `format: "xlsx"` — is called. The fuzzy metrics of §4.6 are implemented in-library and add **no** new dependency.

- **Purity**: per Core Spec §1.6 the engine performs no I/O and never mutates its inputs. The only DOM/browser API used anywhere in the library is `Blob` construction in the exporter.

## 2. Distribution Artifacts & Loading

Published `dist/` contents:

```
dist/
├── table-validation.js          // hand-authored IIFE, inline /*! */ license header
│                                 // (a minified variant is optional; not part of this profile version)
├── table-validation.d.ts        // hand-authored TypeScript declarations for the FULL public
│                                 // surface (engines, results incl. diff, builder, configModel,
│                                 // ingest, normalization, inference, errors); kept in lockstep —
│                                 // test/node-runner.js reflects over TableValidation and asserts
│                                 // every exported member is declared
└── table-validation-worker.js   // hand-authored classic-worker wrapper (§3.14)
```

TypeScript consumers reference the declarations with `/// <reference path="…/table-validation.d.ts" />` (or `typeRoots`); the file declares the global `TableValidation` namespace — no module system involved.

Load order (Luxon before the engine if temporal columns are used; ExcelJS any time before any exporter):

```html
<script src="https://cdn.jsdelivr.net/npm/luxon@3/build/global/luxon.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/exceljs@4/dist/exceljs.min.js"></script> <!-- optional -->
<script src="https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@v1.2.0/dist/table-validation.js"></script>
<!-- or a plain local copy: <script src="dist/table-validation.js"></script> -->
```

The library file MUST NOT read the dependency globals at load time — only at call time (`globalThis.luxon`, `globalThis.ExcelJS`), so load order relative to optional dependencies is free.

## 3. Public API

All entry points live on the global `TableValidation` object. The library adds exactly one global. `validate()` and `compare()` return the **same result shape** (§3.1); `compare()` additionally carries the comparison diff.

### 3.1 Result Model: Severity & Termination

Both engines emit the Core Spec §9 result. Two cross-cutting parts of that shape are restated here because the JS API surface exposes them directly.

**Severity vocabulary — `{ error, warning }`.** There is no `info` and no `halt`. `summary.bySeverity` is:

```javascript
summary.bySeverity   // { error: number, warning: number }   (no info, no halt)
```

- `error` gates the run: `valid === (summary.bySeverity.error === 0)`.
- `warning` is recorded and listed but does not gate.
- Former `info` schema advisories (e.g. `irrelevantSetting`) are now emitted at `warning`. Anything that was pure diagnostics/logging is **out of the result model** — the result carries facts, not log lines.

**Termination — two orthogonal axes.** "How bad is it?" (severity) and "should the run stop?" (termination) are separate. Every result carries:

```javascript
result.aborted       // boolean — the run stopped before completing all applicable phases
result.abortReason   // string | null — enum below when aborted, else null
```

- **Abort (intrinsic, not tunable):** the engine cannot meaningfully continue. It records ≥1 `error` **and** sets `aborted:true`, so an abort always implies `valid:false`. Reasons:
  - `validate()`: `"schemaInvalid"`, `"headersMissing"`, `"customFunctionError"`, `"customFunctionContractViolation"`.
  - `compare()`: the same set **plus** `"duplicateMatchKey"`.
- **Fail-fast (policy, tunable):** the engine *could* continue but the caller/schema asked to stop after a failure. Expressed by either:
  - per-column or per-check **`stopOnFail: true`** — if that rule fails, abort with `abortReason: "stopOnFail:<ruleName>"` (severity stays `error`; the *stop* is the separate flag); or
  - global **`resultConfig.stopPolicy: "never" (default) | "firstError"`** — `"firstError"` aborts on the first `error`-severity violation with `abortReason: "stopPolicy"` (Core Spec §2.2 is the canonical abort-reason list).
- The volume-based circuit breakers (`maxErrors`/`maxErrorsPerColumn`) remain a *separate* termination member and keep reporting through `truncated`/`truncationReason`; `aborted`/`abortReason` are for correctness-based stops.

**Verdict.** `buildReport(result).verdict` is `"aborted"` when `result.aborted`, else `"fail"` (error > 0), `"passWithWarnings"` (warning > 0), or `"pass"`. `"halted"` no longer appears.

### 3.2 `TableValidation.validate`

```javascript
TableValidation.validate(schema, table, options) → result
```

- `schema` — a schema object per Core Spec §4–§6. Not mutated; resolution (Core Spec Phases 2–3) happens on an internal copy.
- `table` — a `TableInput` per Core Spec §1.5: `{ headers: string[] | null, rows: Cell[][] }`. Not mutated.
- `options` (optional):

```javascript
{
    functions:        { [name: string]: Function },  // custom check registry (§4.3); default {}
    referenceInstant: Date | string | null           // pins "now" for Phase 3 (T+/-N resolution);
                                                      //   ISO 8601 string or Date; default: current time.
                                                      //   Exposed per Core Spec §1.6 for determinism testing.
}
```

- Returns the result object of Core Spec §9 **synchronously**, in the shape of [§3.1](#31-result-model-severity--termination) (`summary.bySeverity` = `{ error, warning }`, plus `aborted`/`abortReason`). Data problems are never thrown — they are violations in the result.
- Throws `TableValidationConfigError` only for caller errors: non-object `schema`/`table`, `rows` not an array of arrays, unusable `referenceInstant`, or a required dependency global missing (see [§1](#1-scope--runtime-requirements)). Schema *content* errors are not thrown — they surface as an `error`-severity `schemaValidationError` violation with `aborted:true, abortReason:"schemaInvalid"` per Core Spec Phase 1 (this is an intrinsic abort, not a fail-fast policy).

### 3.3 `TableValidation.compare`

```javascript
TableValidation.compare(schema, produced, expected, options) → result
```

The comparison peer of `validate()` (Core Spec §14.3): when declarative rules are not enough but a known-good **expected** table exists, validation becomes comparison. `compare()` interprets *both* tables with one schema, pairs their rows on a match key, classifies every compared cell into a factual **outcome**, maps outcomes to **severity** by a configured policy, and returns the standard result plus a comparison **diff**. It is a standalone building block — no coupling to `validate()`.

- `schema` — the same schema object used for validation, **plus** a `comparison` section (below). The type/format/zone declarations of `columns.*` interpret both sides; `comparison` adds only the comparison policy. Not mutated.
- `produced`, `expected` — two `TableInput`s (Core Spec §1.5), the table under test and the reference. Neither is mutated. Build them with the same [§3.9 adapters](#39-input-adapters).
- `options` (optional) — **identical to `validate()`'s**:

```javascript
{
    functions:        { [name: string]: Function },  // custom registry: diff checks (§3.3),
                                                      //   tolerance fns (§4.7), etc.; default {}
    referenceInstant: Date | string | null            // pins "now" for T+/-N; default current time
}
```

- Returns **synchronously** the Core Spec §9 result shape of [§3.1](#31-result-model-severity--termination) — `summary` (with `bySeverity` `{ error, warning }`, `aborted`/`abortReason`) and, when `resultConfig.collectCellRegister` is on, a `register` — **plus** `result.diff`, the dense comparison structure (one entry per matched/orphan row, each carrying every compared cell's `rollup` / `tier` / interpreted values / measurements `delta`·`tolerance`·`similarity`, plus per-row `checkFails` and table-level `tableCheckFails` — failed diff checks recorded **regardless of severity**). The diff is severity-independent and always complete; it is what `exportComparisonXlsx` renders. The comparison `summary` carries `rowsChecked`/`columnsChecked` under the same names as validation (so `buildReport` works on both engines) plus `rowsProduced`/`rowsExpected`/`rowsMatched`/`rowsMissing`/`rowsUnexpected`; its `byPhase` has the comparison keys `{ schemaValidation, structuralComparison, cellComparison, comparisonChecks }` (Core Spec §15.10).
- Throws `TableValidationConfigError` on the same caller errors as `validate()` (non-object args, malformed rows, unusable `referenceInstant`, missing dependency global). Schema/comparison-config content errors surface as `schemaValidationError` with `aborted:true, abortReason:"schemaInvalid"`. A duplicate match key is an **intrinsic abort** (`abortReason:"duplicateMatchKey"`), not a thrown error — key integrity means the comparison cannot proceed, but it is a data condition.

**The `comparison` schema section** (validated by Phase 1 like everything else):

```javascript
comparison: {
    match: {
        keys: ["id"],                    // composite key; paired on interpreted values
        setMode: "exact",                // exact (default) | superset | subset — governs orphans
        onDuplicateKey: "abort",         // abort (default) | reportAndExclude — Core §15.6:
                                          //   report one duplicateMatchKey violation per duplicated
                                          //   key group and exclude its rows instead of aborting
        fuzzy: {                         // OPTIONAL — omit for exact-key matching only
            components: ["name"],
            threshold: 0.90,             // number OR per-component map; no silent default
            metric: "tokenizedFuzzy",    // tokenizedFuzzy (rec.) | jaroWinkler | levenshtein (§4.6)
            ambiguityMargin: 0.03,       // runner-up within this of winner → ambiguousFuzzyMatch
            maxCandidatePairs: 1000000   // guardrail; exceed → runtime abort
                                          //   (abortReason "maxCandidatePairsExceeded" — a DATA
                                          //   condition, not a schema error; Core Spec §15.6)
        }
    },
    severity: {                          // configurable outcome tier → "none" | "warning" | "error"
        toleranceMatch: "none", interpretedMatch: "warning", fuzzyMatch: "warning",
        crossTypeMismatch: "error", valueMismatch: "error",
        fuzzyKeyMatch: "warning", ambiguousFuzzyMatch: "warning",
        rowMissing: "error", rowUnexpected: "error", columnOnlyOnOneSide: "error"
        // `exact` is not a key — equal cells never produce entries (Core Spec §15.5)
    },
    fields: {                            // per-column comparison options
        exportedAt: { compare: false },                  // interpreted/keyable, not compared
        _sourceTag: { presence: "producedOnly" },        // one-sided technical column (never flagged)
        amount:     { tolerance: 0.01, expectedName: "Betrag" },   // numeric tolerance (§4.7);
                                                          //   the EXPECTED table carries "amount"
                                                          //   under the header "Betrag" (Core §15.6)
        corpName:   { fuzzy: { threshold: 0.88 } }
    },
    scope: {                             // OPTIONAL filter indicator, never a severity lever
        column: "region",
        inScopeValues: ["EU", "UK"],     // or outOfScopeValues (not both); Core Spec §15.7
        matchStrategy: { caseSensitive: false, trim: true, stripSpaces: false },
        outOfScopePolicy: "compare"      // compare (default, tag only) | skip
    },
    diffChecks: {                        // OPTIONAL checks over the diff (row + table level)
        row:   [ { name: "fuzzyNeedsEqualId", type: "custom", fn: "fuzzyIdGuard", severity: "error" } ],
        table: [ { name: "orphanBudget", type: "orphanRateMax", severity: "error", params: { max: 0.05, side: "expected" } } ]
    }
}
```

- **Outcome ⟂ severity.** A cell's outcome (`equal` / `equivalent` / `different`, with a finer tier — `exact`, `toleranceMatch`, `interpretedMatch`, `fuzzyMatch`, `crossTypeMismatch`, `valueMismatch`) is a **fact**, always recorded in the diff and always shown in the comparison cell text. `comparison.severity` is a **separate policy** deciding whether each tier highlights and gates. Mapping a tier to `"none"` silences only its *severity* — never the fact. This is the same severity/observation split `validate()` makes between violations and cell observations.
- **Uninterpretable cells** fall back to raw-string equality (identical raw → `exact`; else `valueMismatch`); catching bad types is `validate()`'s job, not `compare()`'s.
- **Intrinsic aborts** for `compare()` are `duplicateMatchKey` (under the default `onDuplicateKey: "abort"` — the opt-in `"reportAndExclude"` policy turns it into a severity-mapped violation with row exclusion, Core §15.6), `maxCandidatePairsExceeded`, `customFunctionError`, `customFunctionContractViolation` (and `schemaInvalid`). Termination settings: `resultConfig.stopPolicy` and `maxErrors` apply to comparison violations exactly as in validation; `columns.<name>.stopOnFail` and `maxErrorsPerColumn` are **validation-only** and are ignored by `compare()` (Core Spec §15.10).
- Host bindings specific to comparison: fuzzy metrics ([§4.6](#46-fuzzy-metrics-comparison)) and tolerance functions ([§4.7](#47-tolerance-function-registry-comparison)).

### 3.4 `TableValidation.buildReport`

```javascript
TableValidation.buildReport(result) → report
```

Pure function implementing Core Spec §9.3: derives the popup report object from `result.summary`. No dependencies. Works identically on `validate()` and `compare()` results. `report.verdict` is `"aborted"` | `"fail"` | `"passWithWarnings"` | `"pass"` (see [§3.1](#31-result-model-severity--termination)); `"halted"` is gone.

### 3.5 `TableValidation.renderMessage`

```javascript
TableValidation.renderMessage(ruleName, context, templates?) → string
```

Message rendering is **decoupled from recording**. The engine stores `ruleName` + `context` on each register entry and summary group; it does **not** bake a rendered English string into the result at record time. `renderMessage` turns a `(ruleName, context)` pair into a human string, on demand.

- `ruleName` — a Core Spec rule name (e.g. `"typeMismatch"`, `"rangeBreach"`, `"valueMismatch"`).
- `context` — the entry/group context object the result already carries (column, row, bounds, delta, etc.).
- `templates` (optional) — an object `{ [ruleName]: string | (context) => string }` overriding the built-in English defaults. String templates interpolate `context` fields (`"{field} out of range [{min},{max}]"`); function templates receive `context` and return the final string. A missing template falls back to the built-in default.

This is the seam for **localization**, custom wording, and non-text formats (Core Spec §14.1): render French, HTML, or terse variants without post-processing lossy English. `buildReport` and the exporters render through this function.

- **`options.messageTemplates`** — passing `messageTemplates` in `validate()`/`compare()` `options` installs the same override map for any message the engine renders internally (i.e. when a caller opts into eager rendering). Precedence: explicit `templates` argument to `renderMessage` > `options.messageTemplates` > built-in defaults.
- Pure and dependency-free.

### 3.6 `TableValidation.exportXlsx`

```javascript
TableValidation.exportXlsx({ result, table, schema }) → Promise<Blob>
```

Implements the single-table XLSX export contract of Core Spec §9.4 (three sheets, styling, hyperlinks) from a `validate()` result.

- Requires the `ExcelJS` global; otherwise rejects with `TableValidationConfigError`.
- Requires `result.cellRegister` (i.e., the run used `resultConfig.collectCellRegister: true`); otherwise rejects with `TableValidationConfigError` per Core Spec §9.4.
- Requires the same `table` and (raw) `schema` objects the result was produced from; the exporter re-derives the column mapping deterministically.
- Resolves to a `Blob` with MIME type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Triggering a download (object URL + anchor click) is left to the caller.
- Returns a Promise because ExcelJS buffer generation is asynchronous; the export itself performs no network I/O.
- Cell/entry messages are rendered via [`renderMessage`](#35-tablevalidationrendermessage), so `messageTemplates`-localized workbooks are produced by threading the same templates through (an optional `messageTemplates` field on the argument object).

### 3.7 `TableValidation.exportComparisonXlsx`

```javascript
TableValidation.exportComparisonXlsx({ result, table, schema, expected }) → Promise<Blob>
```

Renders a **`compare()`** result as a three-sheet workbook. Requires the comparison **diff** (`result.diff`), i.e. the argument `result` must come from `compare()`; otherwise rejects with `TableValidationConfigError`. `table` is the **produced** table and `expected` the reference table — both are needed to render raw values side by side.

- Requires the `ExcelJS` global; otherwise rejects with `TableValidationConfigError`.
- **Three sheets:**
  - **Comparison** — one row per matched/orphan row; leading filter columns **`Scope`** (in/out/‑, from `comparison.scope`) and **`Match Status`** (matched / fuzzy / missing / unexpected), then one column per compared field. **Cell text = the outcome:** `equal` renders the produced value; `equivalent` renders `⚠ produced ≈ expected`; `different` renders `✖ produced ≠ expected` (type tags `[t]` only when the two interpreted types differ). **Cell highlight = the final (max) severity** over everything touching that cell — its equality tier *and* any column-level diff check — so a cell can *say* "different" while its tint reflects the configured policy; `none` stays neutral.
  - **Errors** — one row per `warning`/`error` outcome (never `none`), with filter columns **Check**, **Severity**, **Scope**, **Match Status**, plus row/column/message and a `Go To` hyperlink into the Data sheet. Sorted severity-first, autofiltered. This is where a cell touched by three checks becomes three rows (against one tinted cell on Comparison).
  - **Data** — the raw produced/expected rows the hyperlinks target.
- Messages render via [`renderMessage`](#35-tablevalidationrendermessage) (localizable).
- Resolves to a `Blob` (same MIME type as §3.6); asynchronous; no network I/O.

### 3.8 `TableValidation.exportAnnotatedXlsx`

```javascript
TableValidation.exportAnnotatedXlsx({ result, table, schema }) → Promise<Blob>
```

The validation counterpart of the comparison Data sheet: renders the **original validated table** with **every** cell tinted by its observation `outcome` — a fully annotated workbook to hand a human reviewer. From a `validate()` result.

- Requires the `ExcelJS` global; otherwise rejects with `TableValidationConfigError`.
- Requires `result.cellObservations`, i.e. the run used **`resultConfig.collectCellObservations: true`** (the dense, O(rows×cols) observation channel — opt-in and memory-priced exactly like `collectCellRegister`); otherwise rejects with `TableValidationConfigError`.
- **Palette — one tint per outcome:**

  | Outcome | Meaning | Tint |
  |---|---|---|
  | `native` | accepted as its declared type as-is, all constraints passed | neutral (no fill) |
  | `interpreted` | accepted only via string interpretation (`strictType:false`, numeric `formats`, temporal parse) | **new light-blue `interpreted` tint** |
  | `effectivelyNull` | matched a null-equivalent, column nullable | muted grey |
  | `violation` | one or more checks failed on the cell | its `worstSeverity` color (error / warning) |
  | `skipped` | a `skip` column | hatched / faint |
  | `notChecked` | unmatched column, or a `maxErrorsPerColumn`-truncated row | none |

  The **`interpreted`** tint is the one new palette entry (distinct from warning/error) so string-coerced cells are visible at a glance — serving *coercion transparency* (spot every string-parsed cell across a feed) and *full annotated export*.
- Resolves to a `Blob` (same MIME type as §3.6); asynchronous; no network I/O.

### 3.9 Input Adapters

Convenience constructors for `TableInput`; each returns a fresh object and never modifies its argument.

```javascript
TableValidation.adapters.fromArrays(data, { hasHeaderRow = false } = {}) → TableInput
// data: any[][]. hasHeaderRow true → first row becomes headers (each cell String()-converted);
// false → { headers: null, rows: data } (byPosition-ready).

TableValidation.adapters.fromObjects(records) → TableInput
// records: object[]. headers = union of own enumerable keys in first-seen order;
// missing keys become native null cells.
```

The adapters are **subsumed by, and remain unchanged alongside**, `ingest()` ([§3.12](#312-tablevalidationingest)): `fromArrays`/`fromObjects` are trivial projections of the `jsonArrays`/`jsonObjects` ingestion formats, kept as synchronous zero-dependency conveniences. CSV/TSV/XLSX parsing is `ingest()`'s job. Remember Core Spec §5.3: CSV empty cells arrive as `""`; include `""` in `nullEquivalents`.

### 3.10 Constants & Errors

```javascript
TableValidation.VERSION        // unified version — the spec-set number the release implements
TableValidation.SPEC_VERSION   // implemented Core Spec version (also emitted in results as specVersion)
TableValidation.TableValidationConfigError   // Error subclass; name "TableValidationConfigError"
TableValidation.TableValidationIngestError   // Error subclass; name "TableValidationIngestError" (§3.12)
```

`VERSION` and `SPEC_VERSION` are the **same string** (§7.3): the library, the spec it implements, and the `specVersion` stamped on every result all move together. The published artifact reports `"1.2.0"`.

Rule of thumb: **thrown/rejected = you called the API wrong; violations (and aborts) in the result = the schema or data is wrong.** `TableValidationConfigError` is still *caller-error only*; it did **not** absorb the former `halt` behavior — schema-content problems and intrinsic aborts (`abortReason`) live in the result, not in a thrown error. `TableValidationIngestError` is the one deliberate exception to this rule, forced by the ingestion contract: `ingest()`'s product *is the table* — when it cannot be produced (unreadable source, format mismatch, limit exceeded) there is no result to carry a violation, so the fatal condition is a rejection carrying the Addendum §B.7 canonical `code` ([§3.12](#312-tablevalidationingest)).

### 3.11 Config Meta-Model & Builder

*(The `authoring` module of Addendum §A.)*

```javascript
TableValidation.configModel                      // ConfigModel descriptor — plain frozen data
TableValidation.createConfigBuilder(seed?) → ConfigBuilder
```

**`configModel`** is the Addendum §A.1 `ConfigModel` descriptor as an inspectable, deeply frozen, JSON-serializable plain object — `{ specVersion, settings, crossRules }` with one `SettingDescriptor` per Core Spec §11/§15.12 setting (rules M1–M5). It is data, not an API to probe: `JSON.stringify(TableValidation.configModel)` round-trips it. UIs render forms from it; the builder validates against it.

**`createConfigBuilder(seed?)`** binds the abstract contract of Addendum §A.4. `seed` is an optional schema JSON (deep-copied, never mutated); omitted, the Addendum §A.6 default seed applies (intentionally incomplete so `validate()` guides completion). The returned builder is a plain object whose methods are exactly the abstract interface, chainable where specified:

```javascript
const b = TableValidation.createConfigBuilder()
    .set("meta.name", "deliveries")
    .addColumn("id",  { type: { name: "int" }, unique: { enabled: true } })
    .addColumn("day", { type: { name: "date", formats: ["dd.MM.yyyy"] }, nullable: true });

const a = b.validate({ functions: { myCheck: fn }, intendedUse: "validate" });
// a = { valid, errors: [{path, expected, actual}], advisories: [{setting, reason}], deferred: [...] }

b.build()             // AUTHORED (sparse) schema JSON — defaults NOT baked in (Addendum §A.5)
b.resolvedPreview()   // fully-resolved view (defaults + overrides applied) — inspection only
```

- **Same rules as the engines** (rule M6): `validate()` applies Core Spec §10 rules 1–57 (plus §15.12 C1–C9 when a `comparison` section is present) and the §8.2 advisory detection, so a builder-clean config never aborts with `abortReason: "schemaInvalid"` at run time.
- **Exhaustive errors** (Addendum §A.4 requirement 7): `errors` carries **every independent Phase-1 defect in one pass** — the internal Phase-1 checker runs in accumulate mode for the builder while the engines keep their abort-on-first fast path. `errors[0]` is the violation an engine would abort with; fixing defects one at a time strictly shrinks the list.
- **Deferred rules, concretely:** rule 30 (custom-function existence) is checked against `options.functions` when supplied, else reported in `deferred` as `"10:30"` (comparison tolerance/diff-check functions likewise defer as `"C5"`/`"C8"`). Rule 4 (IANA-zone validity) is **always checkable in this profile** — via `luxon.IANAZone.isValidZone` when the Luxon global is present, and via the platform `Intl` zone database otherwise — so it never appears in `deferred` here; the deferral mechanism remains defined for profiles without any zone database. Deferred rules are never silently passed.
- `validate(options)` accepts `{ functions?, intendedUse? }`; `intendedUse` defaults per Addendum §A.6 (`"both"` when a `comparison` section is present, else `"validate"`).
- **Pure and dependency-free** (Luxon is optional as above; nothing else is touched): no I/O, deterministic `build()` output with the Addendum §A.5 canonical key order, round-trip identity `createConfigBuilder(b.build()).build() ≡ b.build()`.
- Unknown paths (not enumerated in `configModel`) are rejected with a thrown `TableValidationConfigError` at `set()` time (rule M8) — a misspelled path is a caller error, not a schema violation.

### 3.12 `TableValidation.ingest`

*(The `ingestion` module of Addendum §B.)*

```javascript
TableValidation.ingest(source, ingestSpec, options?) → Promise<IngestResult>
// IngestResult = { table: TableInput, source: SourceProvenance, warnings: IngestWarning[],
//                  normalizationActions?: [{ column, fn, count }] }   // present iff a §B.8 pipeline ran
// options = { normalizationFunctions?: { [name]: (cell, coords, params) => Cell } }

TableValidation.normalizationModel   // frozen registry descriptor — one entry per §B.8 built-in
                                     //   { fn, perColumnOnly, doc, params: [{ name, type, required, default, enum? }] }
```

All behavior — formats, cell mapping, header handling, encoding chain, limits, warnings, error codes — is Addendum §B; this section binds only the host surface.

**Accepted `source` values** (resolved before parsing; anything else rejects with `TableValidationConfigError`):

| `source` | Treated as | Valid for `format` |
|---|---|---|
| `string` | decoded text (encoding stage skipped) — CSV/TSV text, or JSON text (`JSON.parse`d) | `csv`, `tsv`, `jsonArrays`, `jsonObjects` |
| `ArrayBuffer` / `Uint8Array` | raw bytes (encoding stage applies; required form for `xlsx`) | `csv`, `tsv`, `xlsx` |
| `Blob` / `File` | raw bytes via `blob.arrayBuffer()` | `csv`, `tsv`, `xlsx` |
| `Array` | already-parsed JSON rows/records | `jsonArrays`, `jsonObjects` |

- **Always asynchronous** (`Blob` reads and the ExcelJS reader are Promise-based; CSV from a string is wrapped for a uniform signature). The Promise resolves to the full `IngestResult`; the emitted `TableInput` feeds `validate()`/`compare()`/`inferConfig()` directly.
- **CSV/TSV parsing is implemented in-library** per the Addendum §B.3 grammar (RFC 4180 + configurable delimiter/quote) — this supersedes the former "CSV parsing is out of scope" non-goal (§10). No dependency.
- **XLSX** requires the `ExcelJS` global (reader binding, [§4.8](#48-ingestion-bindings-textdecoder-exceljs-reader)); missing global → rejection with `TableValidationConfigError` (environment/caller error, consistent with the exporters).
- **Fatal ingestion conditions** reject with **`TableValidationIngestError`**, carrying `code` (a canonical Addendum §B.7 code — `ingestSpecInvalid`, `sourceUnreadable`, `formatMismatch`, `sheetNotFound`, `encodingUnsupported`, `decodingFailed`, `limitExceeded:<limit>`, `normalizationFunctionError`, `normalizationFunctionContractViolation`) and `detail` (for `ingestSpecInvalid`: an array of `{ path, expected, actual }` in the Core Spec §9.2 shape; for the normalization faults: `{ fn, row, column }`). Warnings never reject — they ride in `result.warnings`.
- **No validation, no judgment**: `ingest()` emits warnings only about lossy mapping facts (Addendum §B.7); every data-quality question belongs to the engines. Ingest → then validate/compare, fully decoupled.
- **Normalization** (Addendum §B.8) is bound in full: the `IngestSpec.normalization` pipeline runs between parse and the emitted `TableInput`. Host functions register through `options.normalizationFunctions` — the ingestion counterpart of the §4.3 custom-check registry — with the Addendum's abstract signature `(cell, { row, column, columnName }, params) → Cell`; a throw rejects with `normalizationFunctionError`, a non-scalar return with `normalizationFunctionContractViolation`. The built-ins (incl. `stripAffix`/`replaceChars`/`fillDown`) are implemented in-library; only `reformatTemporal` touches a dependency (Luxon, lazily). `TableValidation.normalizationModel` exposes the registry descriptor as frozen plain data so UIs can render step editors without hard-coding the function list (the console does exactly this).

```javascript
const bytes = await file.arrayBuffer();   // <input type="file">
const { table, source, warnings } = await TableValidation.ingest(bytes, {
    format: "csv",
    header: { mode: "firstRow" },
    csv:    { delimiter: ";", encoding: "auto" },
    skipRows: 2,           // report title + blank line above the real header (Addendum §B.4)
    skipFooterRows: 1      // trailing totals row
});
// source.encodingUsed e.g. "utf-8" or "windows-1252" (+ an "encodingFallback" warning)
const result = TableValidation.validate(schema, table);
```

### 3.13 `TableValidation.inferConfig`

*(The `inference` module of Addendum §C.)*

```javascript
TableValidation.inferConfig(table, options?) → { draft, report }   // synchronous
```

- `table` — a `TableInput` (Core Spec §1.5), typically `ingest()` output. Not mutated.
- `options` — `{ sampleRows = 1000, name = "inferred-config", suggestRanges = false, suggestPrecision = true, seedComparison = false, allAcceptingFormats = false, exhaustive = false }` (defaults and rules N2–N3, Addendum §C.10; `suggestPrecision` added in 1.1.0 — drafts observed decimal-precision bounds on float columns, decoupled from `suggestRanges`; `exhaustive` added in 1.2.0 — the sample is the whole table, Addendum §C.2).
- `draft` is a schema JSON that **passes Phase 1 by construction** (rule N1) and is directly loadable into `createConfigBuilder(draft)` — infer → edit → validate is one flow. `report` is the Addendum §C.8 `InferenceReport` (per-column confidence `high`/`ambiguous`/`fallback`, ranked alternatives, observed evidence, candidate keys, report-only tolerance suggestions).
- **Temporal ladder step 5 requires Luxon**: when the `luxon` global is absent the step is skipped entirely (temporal-looking columns fall through to `string`) and `report.limitations` records `"temporalDisabled:luxon"` — deterministic for that binding set (Addendum §C.9), never a throw.
- Everything else is dependency-free and pure; two calls with the same `(table, options)` return deep-equal results.
- Throws `TableValidationConfigError` only for caller errors (non-`TableInput` argument, invalid options per N2–N3). The draft itself can never be "invalid data" — inference is a suggestion generator, not a validator.

### 3.14 Worker Wrapper & Message Protocol

`dist/table-validation-worker.js` is a small hand-authored **classic worker** script (CDN-fetchable from the same tag). It `importScripts('table-validation.js')` from its own directory at startup and proxies the four heavy entry points over `postMessage`.

```javascript
const w = new Worker('https://cdn.jsdelivr.net/gh/<owner>/table-validation-js@v1.2.0/dist/table-validation-worker.js');
w.postMessage({ id: 1, op: 'validate', args: [schema, table, { referenceInstant }] });
w.onmessage = (ev) => { /* ev.data = { id: 1, ok: true, result } */ };
```

**Protocol.** Every request is `{ id, op, args }` (the `id` is any caller-chosen value, echoed back); every request yields exactly one response — `{ id, ok: true, result }` or `{ id, ok: false, error: { name, message, code, detail } }` (the error fields mirror the thrown/rejected error, incl. `TableValidationIngestError.code`/`detail`).

| `op` | `args` | `result` |
|---|---|---|
| `ping` | `[]` | `{ version }` |
| `init` | `[scriptUrls: string[]]` | `{ imported }` — `importScripts` dependency bundles (Luxon, ExcelJS) into the worker; run once before temporal/XLSX work |
| `validate` | `[schema, table, options?]` | `ValidationResult` |
| `compare` | `[schema, produced, expected, options?]` | `ComparisonResult` |
| `ingest` | `[source, ingestSpec, options?]` | `IngestResult` (`Blob`/`ArrayBuffer` sources are structured-clone-able) |
| `inferConfig` | `[table, options?]` | `InferenceResult` |

**Structured-clone safety.** Results are sanitized before posting: any non-plain object — in practice the Luxon `DateTime` instances carried as interpreted temporal values in `cellObservations` and diff cells — is rendered to its ISO string (`.toISO()`), everything else passes through unchanged. Results are otherwise identical to the main-thread engines.

**Limitation (by design).** Function registries (`options.functions`, `options.normalizationFunctions`) cannot cross the boundary — functions are not structured-clone-able. Configs that need host functions run on the thread that owns the registry; the worker rejects them exactly as an engine without the registry would (Phase-1 rule 30).

The **console** feature-detects: served over http(s) it runs `validate()`/`compare()` through this worker (keeping the UI thread free — resolving its documented main-thread deviation for hosted deployments); from `file://`, where workers are unavailable, it falls back to the main thread. The worker protocol has its own browser suite, [`test/worker.html`](test/worker.html) (requires http, unlike the main suite).

## 4. Host Capability Bindings

Numbering follows the five capabilities of Core Spec §1.6.

### 4.1 Regex Engine

- Native ECMAScript `RegExp`. The normative dialect of Core Spec §13.1 *is* this engine, so no mapping layer exists.
- Compile: `new RegExp(pattern, flags)` inside `try/catch` during Phase 1 (Core Spec rule 47); a `SyntaxError` becomes a `schemaValidationError` violation.
- Match: `regex.test(value)`. Flags are restricted to `imsu` by Phase 1 (rule 24); `g`/`y` never reach construction, so no `lastIndex` state exists.
- Patterns MUST be compiled once per column during schema resolution and reused across rows.

### 4.2 Temporal Engine (Luxon)

- Luxon 3.x, accessed as `globalThis.luxon`.
- **Parsing**: `luxon.DateTime.fromFormat(input, format, { zone })`. Luxon's `fromFormat` enforces whole-string consumption, satisfying Core Spec §13.3. The Core Spec token table is a subset of Luxon's; formats are passed through unmapped.
- **Format validity** (Core Spec rule 48): a format string is valid iff Luxon accepts it; verified in Phase 1 by parsing a probe value and checking Luxon reports a format-level (not value-level) failure mode. Token *coverage* (rule 21) is checked by the engine itself via token scanning, not delegated to Luxon.
- **Zone resolution** (Core Spec §5.4 / rule 4):
  - `"utc"` → `"utc"`
  - `"local"` → `"system"` (host zone; results become machine-dependent, as the Core Spec warns)
  - anything else → must satisfy `luxon.IANAZone.isValidZone(name)`; otherwise `schemaValidationError`.
- **Timezone database**: the browser's, via `Intl` (this is the "timezone database" input to the determinism statement of Core Spec §1.6).
- **`T+/-N`** (Core Spec §13.4): `ref.setZone(zone).plus({ days: n })` / `.minus({ days: n })` — calendar-day arithmetic, DST-safe; date-type bounds then snap via `.startOf('day')` / `.endOf('day')`.
- **Comparisons**: datetimes by `toMillis()`; dates and times by calendar fields in the schema zone.

### 4.3 Custom Function Registry

- The registry is the `options.functions` plain object; keys are the `fn` names referenced by `custom` checks. Phase 1 rule 30 (function existence) is evaluated against this object: `typeof functions[fn] === "function"`.
- Call signatures are exactly the abstract interfaces of Core Spec §7.1/§7.2, with maps realized as plain objects and lists as arrays:

```javascript
// row check
(row, interpreted, rowIndex, params) → Array<{ field, pass, message }>
// table check
(rows, interpreted, params) → Array<{ row, field, pass, message }>
```

- The engine invokes every custom function inside `try/catch`; a thrown value becomes `customFunctionError:<checkName>` with `String(err && err.message || err)` captured in context. Duplicate (row,)field results become `customFunctionContractViolation:<checkName>`. Both are **intrinsic aborts** (Core Spec §7): recorded at `error` severity with `aborted:true` and the matching `abortReason` — they are no longer a `halt` severity ([§3.1](#31-result-model-severity--termination)).
- The objects passed to custom functions are shallow copies; mutating them MUST NOT affect the validation run.
- This registry is shared with `compare()`: diff-check functions ([§3.3](#33-tablevalidationcompare)) and tolerance functions ([§4.7](#47-tolerance-function-registry-comparison)) resolve against the same `options.functions` object, with the same fault-to-abort contract.

### 4.4 Number & Boolean Parsing

- Implemented in-library per Core Spec §13.2 and §6.4. `parseInt`, `parseFloat`, and bare `Number()` are **not** used for cell acceptance (`parseInt`/`parseFloat` accept prefixes; `Number("")` is `0`) — acceptance is anchored regex match first, then `Number()` on the sanitized working copy:

```javascript
const INT_RE   = /^[+-]?[0-9]+$/;
const FLOAT_RE = /^[+-]?[0-9]+(\.[0-9]+)?$/;
```

- NumberFormat interpretation follows the 6-step algorithm of Core Spec §3.5 on a working copy; the cell string itself is untouched.
- Int safe-range check: `Number.isSafeInteger(v)` (matches Core Spec §1.5's 2^53 − 1 bound).
- Canonical string conversion (Core Spec §1.5): `String(value)` — ECMAScript Number-to-String is the shortest round-tripping decimal, satisfying the requirement. Booleans → `"true"`/`"false"`.
- Boolean acceptance: `matchStrategy` applied to both the cell and each `trueValues`/`falseValues` entry, then string equality; strategy steps per Core Spec §3.2 (trim → stripSpaces → `toLowerCase()`).

### 4.5 Spreadsheet Writer (ExcelJS)

ExcelJS 4.x, accessed as `globalThis.ExcelJS`. Contract-to-API mapping for Core Spec §9.4:

| Contract feature | ExcelJS API |
|---|---|
| cell fill / font / bold | `cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }`, `cell.font` |
| frozen header row | `sheet.views = [{ state: 'frozen', ySplit: 1 }]` |
| auto-filter | `sheet.autoFilter = { from, to }` |
| internal hyperlinks | `cell.value = { hyperlink: "#'Data'!C5", text: '→ cell' }` |
| column widths | `column.width = clamp(10, longest + 2, 60)` |
| buffer output | `workbook.xlsx.writeBuffer()` → `new Blob([buffer], { type })` |

SheetJS Community Edition is NOT an acceptable substitute (no style writing — fails capability 5).

The same API mapping serves all three exporters ([§3.6](#36-tablevalidationexportxlsx), [§3.7](#37-tablevalidationexportcomparisonxlsx), [§3.8](#38-tablevalidationexportannotatedxlsx)). The comparison and annotated exporters add: the `Scope` / `Match Status` filter columns feed the same `sheet.autoFilter`; per-cell tints (comparison max-severity highlight, annotated `outcome` palette including the new `interpreted` light-blue) use the same `cell.fill` solid-pattern `fgColor.argb` mechanism.

### 4.6 Fuzzy Metrics (comparison)

The `comparison.match.fuzzy.metric` selector (§3.3) binds to a string-similarity function returning a score in `[0,1]`. **All three metrics are implemented in-library in native JavaScript — they add no dependency** (the §1 "core works with neither global present" guarantee covers them). Cell-level `fuzzyMatch` and key-level `fuzzyKeyMatch` both draw from this registry; keys and cells use only native string operations (the §3.2 `matchStrategy` normalization — trim → stripSpaces → `toLowerCase()` — is applied first).

| `metric` | Algorithm | Notes |
|---|---|---|
| `tokenizedFuzzy` (recommended) | tokenize on whitespace/punctuation (after `matchStrategy`), align tokens greedily with per-token edit-distance similarity, aggregate `2·Σpair / (\|P\|+\|E\|)` | handles word **reordering** *and* slight **word-form** drift; character metrics cannot reorder |
| `jaroWinkler` | Jaro similarity with the Winkler common-prefix boost | good for short strings / typos; no reordering |
| `levenshtein` | `1 − editDistance / max(\|a\|,\|b\|)` (code-point edit distance) | plain character edit distance |

- Determinism: fuzzy key pairing is greedy and deterministic — produced rows in schema order claim the best remaining candidate; ties break to the lowest expected index. A runner-up within `ambiguityMargin` of the winner additionally raises `ambiguousFuzzyMatch`.
- `maxCandidatePairs` guards the pairing cost; exceeding it is a config error surfaced as `schemaInvalid` (abort), not a silent truncation.
- Edit distance uses code points (`Array.from`), consistent with the §5 string-length rule; no external Unicode tables.

### 4.7 Tolerance Function Registry (comparison)

Numeric comparison tolerances (`comparison.fields.<col>.tolerance`, §3.3) may be a constant, a per-row driver, a relative percentage, or a **custom function** resolved against the same `options.functions` object as custom checks (§4.3). The custom form:

```javascript
comparison: { fields: {
    yield: { tolerance: { fn: "yieldTol" } }   // → looks up options.functions.yieldTol
}}

// tolFn signature:
(row, interpreted, params) → number    // the per-row tolerance ε ≥ 0
//   row         — the authoritative side's raw row ("from": "expected" (default) | "produced")
//   interpreted — that row's interpreted values (map)
//   params      — the field's tolerance params object
```

A within-tolerance non-exact numeric pair (`|producedᵢ − expectedᵢ| ≤ ε(row)`) is the `toleranceMatch` tier; the diff entry context carries `{ delta, tolerance, toleranceSource }`.

- **Contract (same fault-to-abort rule as §4.3):** a `tolFn` that **throws** → `customFunctionError` (intrinsic abort); a return that is **negative or `NaN`** → `customFunctionContractViolation` (intrinsic abort). Both record `error` + `aborted:true`.
- The non-custom tolerance forms — `tolerance: 0.01` (absolute), `{ field, from }` (per-row from another column), `{ percent, of }` (relative `|value|·%/100`) — need no registry entry and are evaluated in-library.

### 4.8 Ingestion Bindings (TextDecoder, ExcelJS reader)

*(Bindings for the `ingestion` module, [§3.12](#312-tablevalidationingest).)*

**Text decoding** (Addendum §B.5) binds to the platform `TextDecoder` — present in every reference browser, no dependency:

- Explicit encoding: `new TextDecoder(label, { fatal: true })`. An unsupported label throws `RangeError` at construction → `TableValidationIngestError` code `encodingUnsupported`; an undecodable sequence throws at decode → code `decodingFailed`. `{ fatal: true }` is mandatory — the default replacement mode would silently corrupt mis-declared input, exactly what the Addendum forbids.
- `"auto"` chain: BOM sniffing is a plain byte inspection (`EF BB BF`, `FF FE`, `FE FF`); the strict UTF-8 attempt is `new TextDecoder("utf-8", { fatal: true })` inside `try/catch`; the fallback is `new TextDecoder("windows-1252")` (a required label in the WHATWG Encoding Standard; it maps every byte, so the final step cannot fail).
- BOM stripping: `TextDecoder` with default options already strips a leading UTF-8/UTF-16 BOM matching its encoding, satisfying the Addendum's stripping rule.

**XLSX reading** (Addendum §B.3) binds to ExcelJS 4.x (`globalThis.ExcelJS`), the same global as the exporters — the profile adds no second spreadsheet library:

| Addendum §B.3 mapping input | ExcelJS surface |
|---|---|
| used range, row-major | `workbook.xlsx.load(arrayBuffer)` then `worksheet.eachRow({ includeEmpty: true })` |
| sheet selection | `workbook.worksheets[i]` (0-based index) / `workbook.getWorksheet(name)`; miss → `sheetNotFound` |
| formula cached result | `cell.formula` with `cell.result` (absent result → `null` + `formulaNoCachedResult` warning) |
| error value | `cell.value.error` string (e.g. `"#DIV/0!"`) |
| rich text | concatenate `cell.value.richText[].text` |
| hyperlink | `cell.value.text`, else `cell.value.hyperlink` |
| merged non-master cell | `cell.isMerged && cell.master !== cell` → `null` + one `mergedCell` warning per range |
| date/datetime | ExcelJS yields a JS `Date` (UTC fields carry the workbook's zone-less wall time); render the Addendum's ISO string from its **UTC** components — no Luxon needed, no zone math (workbook temporal values are zone-less by definition) |

SheetJS Community Edition remains excluded (§4.5); the reader and writer sides deliberately share one dependency.

## 5. Implementation Notes

- **Interpreted-value memoization** (Core Spec §8.6 SHOULD): interpreted values are computed once in Phase 6 and stored in a column-major array reused by Phases 7–9. Memory: one slot per (row × schema column); the sentinel for "uninterpretable" is distinct from `null` (effectively null).
- **String length** in code points (Core Spec §6.1): `Array.from(str).length`, or an equivalent code-point iteration — never `str.length` (UTF-16 units).
- **Case folding** (Core Spec §3.2): `String.prototype.toLowerCase()` (Unicode simple lowercase).
- **Summary aggregation** is the running, fixed-memory algorithm of Core Spec §8.10 — the register is never scanned to build the summary, so `collectCellRegister: false` runs in O(groups) result memory.
- **Dense channels stay out of the summary.** The optional `cellObservations` (`collectCellObservations:true`) and the `compare()` `diff` are **dense** (O(rows×cols)) and are computed *alongside*, never *into*, the fixed-memory summary — so §8.10's guarantee is unaffected whether or not they are collected. Both reuse the Phase-6 interpreted-value memoization; the observation `outcome` is tagged as each cell is interpreted.
- **Message decoupling:** `record()` stores `(ruleName, context)` only; the English string is produced lazily by [`renderMessage`](#35-tablevalidationrendermessage) in `buildReport`/exporters (or eagerly in `finalize()` when `options.messageTemplates` is set). No rendered string is baked into the register at record time.
- **Determinism**: with `referenceInstant` pinned and `timezone` ≠ `"local"`, output is a pure function of the arguments; the test suite (§9) relies on this.
- **No mutation guarantee**: development builds MAY `Object.freeze` the inputs to catch accidental writes; production builds MUST NOT (cost, and freezing is observable by the caller).
- **Web Workers**: the engine and exporter use no DOM APIs (`Blob` exists in workers), so both run in a worker; recommended for tables above ~10⁵ cells to keep the UI thread free.

## 6. Repository Layout (no build step)

```
table-validation/
├── dist/
│   └── table-validation.js  // hand-authored vanilla ES2020 IIFE — source AND artifact
├── test/                    // browser-run conformance harness + vectors (§9)
│   ├── index.html           // open in a browser (file:// works) to run all suites
│   ├── COVERAGE.md          // rule name → covering vector file
│   └── vectors/*.js         // golden vectors as plain <script>-loadable files
└── README.md
```

**There is no build step.** `dist/table-validation.js` is written and maintained by hand as a single IIFE exposing the `TableValidation` global. Requirements:

- Vanilla ECMAScript 2020; runs as-is via `<script src>` in the reference browsers. No module syntax, no toolchain of any kind (no npm, no bundler, no transpiler, no node test runner).
- Internal organization by concern (primitives, meta-schema validation, resolution, one section per pipeline phase, the comparison phase — pairing → cell outcomes → diff checks, aggregation, the dense observation/diff channels, message rendering, report, adapters, the three exporters, the config meta-model/builder, the ingestion parsers, and inference) via plain functions inside the IIFE.
- Luxon and ExcelJS are **not** referenced at load time — they are read from `globalThis` at call time, so the file stays dependency-free.
- The file MUST open with a license/version header comment in the minification-surviving form (`/*! ... */`), so an optionally minified copy (produced later with any standalone minifier, if ever) retains it.

## 7. CDN Publishing

CDN publishing is possible and is the intended distribution channel. You do not run your own CDN: you tag a repo (GitHub) or publish a package (npm), and public CDNs serve it.

### 7.1 Route A: GitHub → jsDelivr (recommended — no toolchain required)

jsDelivr serves files straight from GitHub tags; no npm, no node, no registration:

```
https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@v1.2.0/dist/table-validation.js
```

Release procedure (git only):

```bash
git add dist/table-validation.js README.md test/
git commit -m "release v1.2.0"
git tag v1.2.0
git push --follow-tags
```

Requires `dist/` to be committed in the tagged release (it is — the file is the source). Treat published tags as **immutable**: never re-tag changed content under the same version (CDNs cache exact-version URLs permanently). Fixes are new patch tags.

### 7.2 Route B: npm → jsDelivr / unpkg (alternative; requires npm)

Only available from an environment that has npm. Any public npm package is automatically served by jsDelivr and unpkg — no registration with the CDNs, no upload step beyond `npm publish`.

`package.json` (relevant fields):

```json
{
    "name": "@yourscope/table-validation",
    "version": "1.2.0",
    "description": "Schema-driven table validation & comparison engine (Core Spec 1.2.0, Browser JS profile)",
    "license": "MIT",
    "files": ["dist", "README.md"],
    "main": "dist/table-validation.js",
    "browser": "dist/table-validation.js",
    "unpkg": "dist/table-validation.js",
    "jsdelivr": "dist/table-validation.js",
    "sideEffects": false,
    "repository": { "type": "git", "url": "https://github.com/sergeiosipov/table-validation" }
}
```

The `unpkg`/`jsdelivr` fields set the default file served for extension-less URLs. Release: `npm version 1.2.0 && npm publish --access public && git push --follow-tags`. Resulting URLs:

```
https://cdn.jsdelivr.net/npm/@yourscope/table-validation@1.2.0/dist/table-validation.js
https://unpkg.com/@yourscope/table-validation@1.2.0/dist/table-validation.js
```

npm gives you a manifest, semver ranges, and provenance — use this route when an npm-capable environment is available. The same immutability rule applies: never republish changed content under the same version.

### 7.3 Versioning & Pinning Policy

- **Unified version.** The unified number names the **specification set**; a library release adopts it when — and only when — it implements that set. `VERSION === SPEC_VERSION` in every release, and every result stamps that number as `specVersion`. A profile release therefore always states exactly which Core Spec it implements; there is no separate library-semver track to reconcile.
- **Version vs. artifact.** The version applies to a release only when the artifact actually implements the spec set. `dist/table-validation.js` implements this document in full and reports `VERSION === SPEC_VERSION === "1.2.0"`.
- **Consumers SHOULD pin exact versions in production** (e.g. `@1.2.0` for the current artifact). Range URLs (`@1`, `@1.0`) exist on jsDelivr and auto-track releases — convenient for prototypes, but they defeat integrity checking and reproducibility.
- Schemas remain portable across releases implementing the same Core Spec MAJOR (Core Spec §1.6).

### 7.4 Subresource Integrity

For exact-version URLs, publish SRI hashes in the release notes and use them:

```powershell
# PowerShell (no extra tooling):
$h = [System.Security.Cryptography.SHA384]::Create().ComputeHash([IO.File]::ReadAllBytes("dist/table-validation.js"))
"sha384-" + [Convert]::ToBase64String($h)
```

```html
<script src="https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@v1.2.0/dist/table-validation.js"
        integrity="sha384-<hash>" crossorigin="anonymous"></script>
```

SRI is incompatible with range URLs (content changes ⇒ hash breaks) — one more reason to pin.

## 8. Usage Examples

Validate a raw CSV feed (headerless) and export the annotated workbook:

```html
<script src="https://cdn.jsdelivr.net/npm/luxon@3/build/global/luxon.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/exceljs@4/dist/exceljs.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@v1.2.0/dist/table-validation.js"></script>
<script>
const schema = {
    meta: { schemaVersion: "1.2.0", name: "deliveries" },
    resultConfig: { collectCellRegister: true },
    nullHandling: { nullEquivalents: ["", "NA"] },
    evaluation: { strictType: false, timezone: "Europe/Luxembourg" },
    structure: { columnMatching: "byPosition", columnCount: { min: 3, max: 3, minInclusive: true, maxInclusive: true } },
    columns: {
        id:     { type: { name: "int" }, unique: { enabled: true } },
        amount: { type: { name: "float", formats: [{ decimalSeparator: ",", groupingSeparators: [" "] }] } },
        day:    { type: { name: "date", formats: ["dd.MM.yyyy"] }, nullable: true }
    },
    customRowChecks: [
        { name: "amountPositive", type: "custom", fn: "positive", severity: "warning", params: { field: "amount" } }
    ]
};

const table = TableValidation.adapters.fromArrays([
    ["1", "1 234,50", "15.07.2026"],
    ["2", "-3,00",    ""]
]);

const result = TableValidation.validate(schema, table, {
    functions: {
        positive: (row, interpreted, i, p) =>
            interpreted[p.field] !== null && interpreted[p.field] <= 0
                ? [{ field: p.field, pass: false, message: "amount must be positive" }]
                : []
    }
});

console.log(TableValidation.buildReport(result).verdict);

if (!result.valid) {
    TableValidation.exportXlsx({ result, table, schema }).then(blob => {
        const a = Object.assign(document.createElement("a"),
            { href: URL.createObjectURL(blob), download: "validation-report.xlsx" });
        a.click();
        URL.revokeObjectURL(a.href);
    });
}
</script>
```

Compare a produced feed against a known-good reference and export the comparison workbook (fuzzy name matching, a numeric tolerance, and a localized message template):

```html
<script>
const cmpSchema = {
    meta: { schemaVersion: "1.2.0", name: "deliveries-compare" },
    resultConfig: { collectCellRegister: true },
    evaluation: { strictType: false, timezone: "utc" },
    columns: {
        id:     { type: { name: "int" } },
        name:   { type: { name: "string" } },
        amount: { type: { name: "float" } }
    },
    comparison: {
        match:    { keys: ["id"], setMode: "exact",
                    fuzzy: { components: ["name"], threshold: 0.90, metric: "tokenizedFuzzy", ambiguityMargin: 0.03 } },
        severity: { valueMismatch: "error", interpretedMatch: "warning", toleranceMatch: "none", rowMissing: "error" },
        fields:   { amount: { tolerance: 0.01 }, name: { fuzzy: { threshold: 0.88 } } },
        diffChecks: { table: [ { name: "mismatchBudget", type: "mismatchRateMax", severity: "error", params: { max: 0.01 } } ] }
    }
};

const produced = TableValidation.adapters.fromArrays([["1","Acme Corp","10.00"],["2","Beta LLC","5.00"]], { hasHeaderRow: false });
const expected = TableValidation.adapters.fromArrays([["1","Acme Corporation","10.005"],["2","Beta LLC","7.00"]], { hasHeaderRow: false });

const cmp = TableValidation.compare(cmpSchema, produced, expected, {
    referenceInstant: "2026-07-10T00:00:00Z",
    messageTemplates: { valueMismatch: (c) => `${c.field}: ${c.produced} ≠ ${c.expected}` }
});

console.log(TableValidation.buildReport(cmp).verdict);   // "aborted" | "fail" | "passWithWarnings" | "pass"
console.log(cmp.aborted, cmp.abortReason);               // e.g. false, null

TableValidation.exportComparisonXlsx({ result: cmp, table: produced, schema: cmpSchema, expected })
    .then(blob => { /* download as in the first example */ });
</script>
```

Ingest an uploaded CSV, infer a draft config, refine it through the builder, and validate — the tooling flow:

```html
<script>
async function onFile(file) {
    // 1. ingest — bytes → TableInput + provenance (no validation happens here)
    const { table, source, warnings } = await TableValidation.ingest(await file.arrayBuffer(), {
        format: "csv", header: { mode: "firstRow" }
    });
    console.log(source.encodingUsed, warnings);

    // 2. infer — TableInput → draft schema + evidence report (a suggestion, never authoritative)
    const { draft, report } = TableValidation.inferConfig(table, { name: "deliveries", sampleRows: 1000 });
    console.log(report.columns.map(c => `${c.name}: ${c.inferredType} (${c.confidence})`));

    // 3. author — edit the draft with authoring-time Phase-1 feedback
    const b = TableValidation.createConfigBuilder(draft)
        .set("columns.id.unique.enabled", true)
        .set("resultConfig.collectCellRegister", true);
    const authoring = b.validate();
    if (!authoring.valid) { console.table(authoring.errors); return; }

    // 4. run — the sparse authored config drives the engine
    const result = TableValidation.validate(b.build(), table);
    console.log(TableValidation.buildReport(result).verdict);
}
</script>
```

## 9. Conformance Testing

The suite is **browser-run**: `test/index.html` loads the library and all vectors via `<script>` tags (vectors are `.js` files pushing plain objects onto a global array, because `file://` pages cannot `fetch()` JSON), executes every suite, and renders a pass/fail report. Opening the file in any reference browser — including from `file://` — runs the full suite; no server, no node required. The **same corpus also runs in Node** via `test/node-runner.js` (plain Node ≥ 20, no npm project; CDN dependency bundles are fetched and cached, and dependent vectors report as *blocked* offline) — both runners are release gates. `test/worker.html` covers the §3.14 worker protocol (needs http); `test/bench.js`/`test/bench.html` is the §5 performance harness (10⁴–10⁷ cells through both engines; the numbers live in the WASM feasibility note).

- **Golden vectors**: a corpus of `(schema, table, options, expected)` quadruples covering every rule name of Core Spec §9.1, every phase gate, both matching modes, circuit breakers, and the null/uninterpretable policies of §7. Expected results are compared structurally (register order per pipeline order).
- **Severity & termination vectors**: assert `summary.bySeverity` is exactly `{ error, warning }` (no `info`, no `halt`); assert every intrinsic abort (`schemaInvalid`, `headersMissing`, `duplicateColumnName` under strategy `"halt"`, `customFunctionError`, `customFunctionContractViolation`, and for `compare()` `duplicateMatchKey` / `maxCandidatePairsExceeded`) sets `aborted:true` with the matching `abortReason` **and** `valid:false`; assert `stopOnFail` and `resultConfig.stopPolicy:"firstError"` produce the `"stopOnFail:<column>"` / `"stopPolicy"` abort reasons (Core Spec §2.2 canonical list); assert `buildReport().verdict === "aborted"` in those cases.
- **Comparison vectors**: `compare(schema, produced, expected, options)` quintuples exercising each cell outcome tier (`exact`/`toleranceMatch`/`interpretedMatch`/`fuzzyMatch`/`crossTypeMismatch`/`valueMismatch`), `setMode` orphan handling, the severity map (including a tier mapped to `none` that stays in the `diff` but produces no register entry), scope filtering, tolerances (all four forms), and row/table diff checks. The native fuzzy metrics (§4.6) have direct unit vectors with known scores.
- **Message-template vectors**: the same `(ruleName, context)` renders the built-in default, an `options.messageTemplates` override, and a `renderMessage(..., templates)` override — all three paths verified.
- **Determinism harness**: every vector runs with `referenceInstant` pinned and `timezone: "utc"`, and runs twice — the two results must be deep-equal; vectors using `T+/-N` additionally run at two pinned instants to verify Phase 3 resolution. Fuzzy pairing determinism (greedy, lowest-index tie-break) is asserted.
- **Purity harness**: inputs are deep-frozen before the call in the test runner; any mutation throws in strict mode. `compare()`'s two tables are both frozen.
- **Parser negative tests**: the partial-parse traps of §4.4 (`"12abc"`, `""`, `"1,2,3"`, whitespace padding) MUST all be rejected.
- Temporal vectors require the Luxon global (CDN `<script>` in the harness); the harness MUST report — not silently skip — vectors it cannot run because a dependency global is absent.
- **Module vectors (§3.11–§3.13)**: builder/engine **parity** (every §10/§15.12-violating schema that aborts an engine with `schemaInvalid` must fail `ConfigBuilder.validate()`, and vice versa for clean schemas; deferred rules asserted with and without the binding supplied); builder round-trip identity and canonical ordering (rule M7); `ingest()` golden vectors at the **byte** level (BOM/encoding chain incl. the windows-1252 fallback, RFC 4180 quoting, XLSX cell-mapping table, every fatal code, limit fail-fast) with expected `IngestResult`s; `inferConfig()` determinism vectors (same input twice → deep-equal; ladder, ambiguity ranking, categorical thresholds, N1 validity of every emitted draft — each draft is itself run through Phase 1).
- The vector corpus is language-agnostic by construction and SHOULD be shared with future profiles (Python, JVM, …) as the cross-profile conformance suite.

## 10. Non-Goals

Deliberately out of scope for this profile version:

- **Any build toolchain.** No bundler, transpiler, minifier, or package-manager step is part of producing or verifying the artifact; the single hand-authored file is the deliverable.
- **ESM/CJS entry points.** Node is a supported runtime (§1) via the global-installing IIFE; dedicated module entry points remain out of scope for this version.
- **Bundler integration** (tree-shaking). TypeScript typings exist (`dist/table-validation.d.ts`, §2) — global-declaration form, not a module.
- **Normalization inside the engines** — `validate()`/`compare()` remain read-only evaluators (Core Spec §1.3); all transformation lives in the ingestion normalization pipeline (Addendum §B.8, §3.12).
