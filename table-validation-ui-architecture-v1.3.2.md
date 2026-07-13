# Table Validation — Authoring & Run Console: UI Architecture Specification

## Document Version: 1.3.2

> **Document set.** This document architects the **Authoring & Run Console** — the user-facing tool that ties the tooling modules (config authoring §A, ingestion §B, inference §C of the *Authoring, Ingestion & Inference Addendum v1.3.0*, the "Addendum") to the two engines (`validate()`, `compare()`) of the *Core Specification v1.3.0* (the "Core Spec"), through the API of the *Browser JS Implementation Specification v1.3.0* (the "JS Profile"). It is an **architecture specification** — flows, information architecture, state model, component contracts, wireframe-level layout — not an implementation. UI is host-specific, so this document lives outside the engine core; it **adds no engine behavior** and reuses engine outputs verbatim.
>
> The console targets the JS Profile's no-build constraint (JS Profile §6): vanilla ES2020, static files, `<script>` tags, no bundler, no framework.

---

## Table of Contents

- [1. Purpose, Scope, Principles](#1-purpose-scope-principles)
- [2. Resolved Design Decisions](#2-resolved-design-decisions)
  - [2.1 D1 — The Config-Artifact Model](#21-d1--the-config-artifact-model)
  - [2.2 D2 — Information Architecture](#22-d2--information-architecture)
  - [2.3 D3 — Uploads, Persistence, Download](#23-d3--uploads-persistence-download)
- [3. Information Architecture & Flows](#3-information-architecture--flows)
  - [3.1 Layout](#31-layout)
  - [3.2 Primary Flows](#32-primary-flows)
- [4. State Model](#4-state-model)
  - [4.1 Store Shape](#41-store-shape)
  - [4.2 Actions & Transitions](#42-actions--transitions)
  - [4.3 Derived State & the Collection-Flag Rule](#43-derived-state--the-collection-flag-rule)
- [5. Component Contracts](#5-component-contracts)
- [6. Result Presentation](#6-result-presentation)
- [7. Persistence Model](#7-persistence-model)
- [8. No-Build Implementation Constraints](#8-no-build-implementation-constraints)
- [9. Errors, Empty States, Guardrails](#9-errors-empty-states-guardrails)
- [10. Out of Scope / Deferred](#10-out-of-scope--deferred)
- [11. Full-Surface Coverage (normative)](#11-full-surface-coverage-normative)

---

## 1. Purpose, Scope, Principles

The console lets a user, in one place: **create a config** (from scratch through the builder, or from an inferred draft), configure **validation** rules and **comparison** settings, **upload** configs and tables, **run** `validate()` and/or `compare()`, and **view/export results** (report, summary, register/errors view, comparison diff grid, XLSX / annotated / comparison exports).

Principles (normative for this architecture):

1. **Thin UI over normative contracts.** Every judgment the console displays comes from an engine or module output — verdicts from `buildReport`, messages from `renderMessage`, diff cells from `result.diff`, authoring errors from `ConfigBuilder.validate()`, form structure from `configModel`. The console never re-implements classification, parsing, or message logic. Where the spec defines a rendering (Core Spec §9.3 verdict lines, §15.11 comparison cell text), the console uses it verbatim.
2. **The artifact is the engine's artifact.** What the user saves, exports, and diffs is a plain schema JSON exactly as the engines consume it (§2.1). Console conveniences (naming, library, timestamps) live *around* the artifact, never inside it.
3. **Descriptor-driven forms.** All settings forms are rendered from `TableValidation.configModel` (Addendum §A.1–§A.3): field kinds from `type`/`enum`, defaults as placeholders, `relevantWhen` drives hide/disable, `dependsOn` drives inline dependency errors, `engines` drives validation-vs-comparison grouping. The console contains **no hand-maintained settings list** — a new spec setting appears in the UI when the descriptor gains it.
4. **Authoring-time honesty.** The builder's `AuthoringValidationResult` is surfaced live: errors block running, advisories (`irrelevantSetting` conditions) render as inline hints, and **deferred** rules are shown as explicit badges — never hidden (Addendum §A.4).
5. **Decoupled stages, mirrored in the UI.** Ingest → infer → author → run are the module boundaries; each is a distinct UI stage with its own status, and no stage silently triggers another (inference is *offered* after ingest, never auto-applied).
6. **No engine state in the UI layer.** The store (§4) holds plain data plus one opaque `ConfigBuilder`. Everything renderable is serializable; the builder is reconstructible from its `build()` output.

Non-goals: multi-user collaboration, server persistence, scheduling/automation, editing table data (the engines are read-only; so is the console's view of data).

## 2. Resolved Design Decisions

### 2.1 D1 — The Config-Artifact Model

> **⚑ Decision point — accepted.** This was a genuine fork; the recommendation below was reviewed and **accepted**. The alternatives remain documented for the record.

**Decision: ONE config artifact — a single schema JSON with an optional `comparison` section (today's engine model). The console manages *multiple named saved configs* of this one kind.**

Rationale:

- **The engines already define this shape.** Core Spec §4 is the interchange format; `compare()` consumes the *same* schema as `validate()` plus its `comparison` section, and comparison-ness is exactly the presence of that section (Addendum §A.4 point 3). A second artifact kind would exist only in the UI — every export/import boundary would need a join semantics no spec defines.
- **Column/type definitions are shared load-bearing state.** Both engines interpret cells through `columns.*`. Split artifacts either duplicate the column blocks (drift: the produced table is interpreted differently by validation and comparison — a correctness hazard, not a style issue) or hold a cross-artifact reference (a new resolution step, new failure modes: dangling refs, version skew between the halves).
- **Round-trip stays identity.** Builder, meta-model, inference draft, export, import, and engine input are all the same JSON document (Addendum §A.5). One artifact kind keeps "what you export is what the engine runs" literally true.
- **Reuse is served at the UI level.** The realistic reuse ask — "same comparison policy across datasets" — is met by a console convenience: **Copy section from…** (copy the `comparison` — or `structure`, or a column block — from another saved config into the active one). This is a JSON edit through the builder, not a new artifact kind, and it covers the reuse case without inventing a join.

Storage/naming/reference model (normative for the console):

- The **config library** holds entries `{ id, name, updatedAt, config }`: `id` generated (opaque, stable), `name` mirrors `config.meta.name` (editable; duplicates allowed, disambiguated by `updatedAt` in the picker), `config` the sparse **authored** JSON (`build()` output — defaults never baked in).
- **Export** writes the bare `config` JSON only — no envelope — so an exported file is directly engine-consumable, hand-editable, and diffable. **Import** accepts a bare schema JSON and creates a library entry named from `meta.name`.
- Multiple saved configs are supported; exactly one is **active** (loaded in the builder) at a time.

Alternatives considered:

| Alternative | Pros | Cons (why not recommended) |
|---|---|---|
| **(a) Two artifacts**: a validation config + a comparison config, saved/loaded independently; a run pairs one of each | Comparison policy reusable across datasets as a first-class file; smaller diffs per artifact; independent versioning | Column definitions must be duplicated or referenced across files — duplication drifts, references need resolution rules, IDs, and error states the spec set doesn't define; a comparison config is not independently valid (its `fields`/`keys` name columns it doesn't carry); import/export becomes two-file handling; every other tool in the set (builder, inference, engines) still speaks single-document |
| **(b) Single artifact + exportable `comparison` overlay** (a JSON fragment applied onto a base config) | Keeps one canonical kind; policy sharing without duplication | Overlay application order/conflict semantics are a new mini-spec; a fragment file is meaningless alone and easy to mis-apply; the same value is delivered more simply by the *Copy section from…* convenience |

### 2.2 D2 — Information Architecture

> **⚑ Decision point — accepted.** This was a genuine fork; the recommendation below was reviewed and **accepted**. The alternatives remain documented for the record.

**Decision: one single-page app with four freely navigable stage tabs plus a persistent readiness rail — a "stepper-shaped workspace", not a wizard.**

The four stages (covering the required areas):

1. **Data** — upload/ingest produced (and, when comparison is on, expected) tables; view provenance & ingest warnings; trigger inference.
2. **Schema** — the builder UI: columns (types, formats, constraints), structure, evaluation, null handling, composite keys, row/table checks, result config. This is "data & schema" + "validation rules" merged: in this spec set they are one artifact section (`columns` carries both the type model *and* the validation constraints), and splitting them into two tabs would force constant back-and-forth while editing a column.
3. **Comparison** — optional stage: match keys, setMode, fuzzy, per-field tolerance/fuzzy/presence, severity map, scope, diff checks.
4. **Run & Results** — output selection, run buttons, and all result views (§6).

Key IA rules:

- **Authoring and running are one mode.** Tabs are always reachable; nothing is locked behind completion. The **readiness rail** (persistent header strip) shows per-stage status (✓ ready / ⚠ issues / ○ empty) and is the only "stepper" element: it *suggests* the left-to-right path on first run and shows at a glance why Run is disabled. Iteration — the dominant loop after the first run (see results → adjust schema → re-run) — is two clicks, with state fully preserved.
- **Comparison optionality is a master toggle** on the Comparison tab (and mirrored in the rail): OFF = the config has no `comparison` section, the expected-table upload slot is hidden, and Run offers **Validate** only — validation-only is the default, first-class flow. ON = the builder gains a minimal valid `comparison` section (`setComparison`), the Data tab grows the *expected* slot, and Run offers **Compare** (and still **Validate**). The toggle *is* the artifact fact (section present/absent) — no separate UI flag to drift.
- **Fewest steps, raw file → result:** on an empty workspace, the Data tab's post-ingest banner offers **"Infer draft config → Run"** as one action: upload file *(1)* → accept "Infer & use draft" *(2)* → **Validate** *(3)*. Three interactions; every artifact produced on the way (draft config, report) is inspectable afterward, not skipped.

Alternatives considered:

| Alternative | Pros | Cons (why not recommended) |
|---|---|---|
| **Linear wizard/stepper** (enforced order, next/back) | Strongest first-run guidance; impossible to run "too early" | Punishes the dominant post-first-run loop (results → tweak one setting → re-run becomes a page march); optional comparison fits awkwardly as a skippable step; wizards fight the "always-valid-artifact" model — the builder allows incomplete states by design and `validate()` is the gate, not page order |
| **One scrolling page** (all four areas stacked) | Zero navigation; everything visible | The settings surface (~100 descriptor paths × N columns + results) is far past single-page legibility; collapse/expand sections end up re-implementing tabs, worse |
| **Two apps** (author here, run there) | Each app simpler | The core loop *is* author↔run; separating them makes the most common transition the most expensive and duplicates config/data loading |

### 2.3 D3 — Uploads, Persistence, Download

**Uploaded artifacts** — exactly three kinds:

| Artifact | Accepted as | What the upload triggers |
|---|---|---|
| **Config JSON** | `.json` file (bare schema document, per §2.1) | Import → new library entry → loaded into the builder → `ConfigBuilder.validate()` runs → authoring panel shows errors/advisories/deferred immediately. Comparison toggle reflects section presence. |
| **Produced table** | `.csv` / `.tsv` / `.xlsx` / `.json` file | The **IngestSpec form** opens pre-filled (format from file extension as a *suggestion* — the user confirms; nothing is sniffed, per Addendum §B.1): format, header mode, delimiter/quote/encoding (CSV/TSV), sheet (XLSX). Confirm → `ingest()` → slot shows provenance (`encodingUsed`, resolved sheet, counts) + warnings. Then: **if no config is active**, a banner offers **Infer draft config**; if one is, a banner offers *Re-infer (replaces column definitions — confirm)*. |
| **Expected table** | same formats | Same ingest flow into the *expected* slot. Visible only while comparison is ON. No inference offer (the schema describes the produced side; both sides are interpreted through it — Core Spec §15.1). |

- Inference is **always explicit**: the user sees `report` evidence (per-column type, confidence, alternatives) and chooses **Use draft** (loads into builder) or dismisses. Never auto-applied (Addendum §C: drafts are suggestions).
- Re-uploading a table replaces the slot after confirmation; the previous run's results are marked **stale** (§4.2) but remain viewable.

**Persistence** (details in §7):

- `localStorage`: the config library and lightweight session state (active tab, active config id, last-used IngestSpec values, output selections). Survives reload.
- **Table data is NOT persisted** (quota-hostile and stale-prone). After reload, data slots show an "re-upload needed" stub carrying the previous file name + provenance so the user knows exactly what to re-select.
- Results are not persisted; they are cheap to regenerate and exportable when they matter.

**Downloads**: active config JSON (§2.1 bare form); result JSON (the full `validate()`/`compare()` result object); the three workbook exporters (`exportXlsx`, `exportComparisonXlsx`, `exportAnnotatedXlsx`); the inference report JSON. All client-side Blob downloads (JS Profile §3.6–§3.8).

## 3. Information Architecture & Flows

### 3.1 Layout

Wireframe-level layout (persistent header + rail; one stage panel visible):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Table Validation Console      Config: [ deliveries ▾ ] [Save] [Import] [⤓]  │  header: config library
├──────────────────────────────────────────────────────────────────────────────┤
│ ① Data ✓        ② Schema ⚠2       ③ Comparison ○(off)      ④ Run ▶          │  readiness rail (tabs)
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                         [ active stage panel ]                               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**② Schema** panel (descriptor-driven master–detail):

```
┌ Columns ──────────────┐ ┌ Column: amount ──────────────────────────────────┐
│ id        int    ✓    │ │ type [float ▾]   nullable [ ]  required [auto ▾] │
│ amount    float  ✓    │ │ ── float settings (from configModel) ─────────── │
│ day       date   ⚠    │ │ formats [+]  value range [   ..   ]  precision…  │
│ [+ add column]        │ │ severity [error ▾]  unique [ ]  stopOnFail [ ]   │
├ Table settings ───────┤ │ ⚠ formats has no effect: effective strictType is │
│ structure ▸           │ │   true (irrelevantSetting preview)               │
│ evaluation ▸          │ └──────────────────────────────────────────────────┘
│ nullHandling ▸        │ ┌ Authoring validation ────────────────────────────┐
│ resultConfig ▸        │ │ ✖ columns.day.type.formats: expected non-empty…  │
│ compositeKeys ▸       │ │ ⚠ 1 advisory · deferred: 10:30 (custom fn)       │
│ row/table checks ▸    │ └──────────────────────────────────────────────────┘
└───────────────────────┘
```

**④ Run & Results** panel:

```
┌ Run ─────────────────────────────────────────────────────────────────────────┐
│ Outputs: [x] Errors view   [x] XLSX report   [ ] Annotated XLSX              │
│ auto-enabled for this run: collectCellRegister (Errors view, XLSX report)    │
│              [ Validate ]              [ Compare ] (comparison off)          │
├ Results ─────────────────────────────────────────────────────────────────────┤
│ ✖ Invalid — 12 error(s), 3 warning(s) in 4 column(s).   (buildReport line)   │
│ [Report] [Summary] [Errors] [Diff] [Data]        Export: [XLSX] [JSON] [...] │
│ ┌ filters: severity ▾  rule ▾  column ▾  scope ▾  match status ▾ ┐           │
│ │ …result grid (per §6)…                                        │            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Primary Flows

**F1 — Raw file to result (fastest path):**
```
Upload produced file → IngestSpec confirm → ingest()
  → banner "No config: [Infer & use draft]" → inferConfig() → draft into builder (validate() clean by N1)
  → rail: ①✓ ②✓ → [Validate] → results
```

**F2 — Author from scratch:** Schema tab → add columns / set table settings (descriptor forms) → live `validate()` after each edit (§4.2) → fix errors as they appear → Data tab upload → Run.

**F3 — Comparison run:** Comparison toggle ON (builder gains minimal `comparison`; rail shows ③) → set match keys (C1 requires ≥1 — authoring error until set) → optional tolerances/fuzzy/severity map → Data tab now shows the *expected* slot → upload both tables → [Compare] → diff grid + errors view with scope/match-status filters.

**F4 — Import, edit, re-export:** Import config JSON → library entry + builder load → authoring result panel (errors/advisories/deferred) → edit → Save (library) / Download (file). Round-trip is content-identical up to canonical key order (Addendum §A.5).

**F5 — Iterate after a run:** results visible → switch to Schema → change a setting → results marked *stale* (banner: "config changed since last run — [Re-run]") → Re-run re-executes with the same data and output selections.

## 4. State Model

One store, one dispatch, unidirectional flow (§8 for the mechanism). All state is plain data except `authoring.builder` (opaque `ConfigBuilder`; reconstructible via `createConfigBuilder(entry.config)`).

### 4.1 Store Shape

```
AppState {
    configs: {
        entries:  [ { id, name, updatedAt, config } ]     // §2.1 library; persisted
        activeId: string | null
    }
    authoring: {
        builder:            ConfigBuilder                  // source of truth for the active draft
        history:            { past: json[], future: json[] }   // bounded (30) undo/redo snapshots
                                                                //   of build(); reset on config load
        lastValidation:     AuthoringValidationResult|null // Addendum §A.4 shape, verbatim
        comparisonEnabled:  bool                           // derived-and-cached: draft has `comparison`
        dirtySinceSave:     bool                           // draft differs from library entry
        dirtySinceRun:      bool                           // draft differs from last run's config
    }
    data: {
        produced: DataSlot
        expected: DataSlot
    }
    // DataSlot {
    //     status:     "empty" | "ingesting" | "ready" | "failed"
    //     ingestSpec: IngestSpec | null                   // as confirmed by the user
    //     table:      TableInput | null                   // never mutated; not persisted
    //     provenance: SourceProvenance | null             // Addendum §B.7, verbatim
    //     warnings:   IngestWarning[]                     // Addendum §B.7, verbatim
    //     error:      { code, detail } | null             // TableValidationIngestError payload
    //     fileMeta:   { name, sizeBytes } | null          // persisted as the re-upload stub
    // }
    inference: {
        status:  "idle" | "running" | "offered" | "dismissed"
        offer:   { draft, report } | null                  // inferConfig() output, verbatim
    }
    advanced: {                                            // §9 advanced mode — custom functions
        enabled: bool                                      // per-session opt-in; NEVER persisted
        sources: [ { name, src } ]                         // pasted function sources; compiled with
                                                           //   the Function constructor only while enabled
    }
    run: {
        status:            "idle" | "running" | "done" | "failed"
        mode:              "validate" | "compare" | null
        viaWorker:         bool                            // engines ran through the §8 worker
        previous:          { result, report, mode } | null // last completed run — feeds the Δ view
        requestedOutputs:  { errorsView: bool, xlsxReport: bool, annotatedXlsx: bool }   // persisted
        effectiveResultConfig: object | null               // §4.3 — what was actually sent
        result:            Result | ComparisonResult | null
        report:            Report | null                   // buildReport(result)
        stale:             bool                            // config or data changed since `result`
        error:             { message } | null              // thrown TableValidationConfigError only
    }
    ui: {
        activeTab: "data" | "schema" | "comparison" | "run"
        dialog:    { kind: "confirm"|"prompt"|"alert", title, text, value, danger, okLabel, onOk } | null
                                                           // inline modal (replaces prompt/confirm/alert)
        resultView: "report" | "summary" | "errors" | "diff" | "data" | "delta"
        filters: { severity, ruleName, column, scope, matchStatus }   // §6; all nullable
        notices: [ { kind, text } ]
    }
}
```

### 4.2 Actions & Transitions

| Action | Effect (all state changes go through here) |
|---|---|
| `config/create` | new builder from default seed; `activeId: null`; run marked stale |
| `config/load(id)` | `createConfigBuilder(entry.config)`; `validate()`; comparisonEnabled from section presence |
| `config/import(json)` | new library entry + `config/load`; malformed JSON → notice, nothing loaded |
| `config/save` | `builder.build()` → library entry (new or overwrite active); `dirtySinceSave: false` |
| `config/download` | serialize `builder.build()` (bare JSON, §2.1) |
| `schema/edit(path, value)` | `builder.set/unset(...)`; then **debounced** `builder.validate()` → `lastValidation`; `dirty*` flags set; run `stale` if a result exists. Unknown path → the builder throws (rule M8) → UI defect notice (forms are descriptor-driven, so this indicates a console bug, not user error) |
| `schema/columnOp(op)` | `addColumn`/`removeColumn`/`moveColumn` + same revalidate path |
| `comparison/toggle(on)` | ON: `builder.setComparison(minimalSection)`; OFF: confirm → `setComparison(null)` and expected slot cleared |
| `data/ingest(slot, source, spec)` | slot → `ingesting`; `await ingest(source, spec)`; resolve → `ready` (+ inference offer logic, §2.3); reject → `failed` with `{code, detail}`; result `stale` |
| `inference/run` / `accept` / `dismiss` | `inferConfig(produced.table, options)` → `offer`; accept → load draft into builder (via `config/load`-like path, unsaved); dismiss keeps the report viewable |
| `run/setOutputs(o)` | update `requestedOutputs` (recomputes the §4.3 preview line) |
| `run/execute(mode)` | guards (§4.3 readiness) → compose effective config (§4.3) → engine call (through the §8 worker over http(s); main thread from `file://` or when an advanced-mode registry is active) → keep the prior completed run in `run.previous` → `result`, `report = buildReport(result)`, `stale: false`. After a re-run of the same mode, the **Δ (delta) view is the default result view** — the iterate-loop feature. |
| `export(kind)` | guards from the flag matrix (§6) → exporter call → Blob download |
| `advanced/*` | enable/disable the per-session custom-function registry; add/edit/remove pasted sources. Enabling recompiles and re-runs authoring validation with `{ functions }`, so rule 30 becomes checkable (a missing function is a real error, not a deferral). Sources are never persisted or exported; a reload turns the mode off. Registry runs bypass the worker (functions cannot cross `postMessage`). |
| `undo` / `redo` | bounded (30) builder-snapshot history; every mutating action snapshots first; config load/import resets the history |
| `dialog/*` | open/ok/cancel for the inline modal that replaces `prompt()`/`confirm()`/`alert()` |
| `workspace/export` / `workspace/import` | one JSON bundle (`tvconsoleWorkspace: 1`): active config, the two IngestSpec forms, data-slot provenance stubs (never the data), requested outputs, `referenceInstant`. Import creates a library entry, loads it, restores the stubs/outputs/instant — the session resumes at "re-upload the file(s) and press Run". |

**Readiness predicates** (drive rail badges and Run buttons; recomputed on every state change):

```
authoringReady   = lastValidation !== null && lastValidation.valid
runnableDeferred = lastValidation.deferred is empty OR contains only rules the console
                   can prove irrelevant to this run (see §9 — custom-fn guardrail)
canValidate      = authoringReady && runnableDeferred && data.produced.status === "ready"
canCompare       = canValidate && comparisonEnabled && data.expected.status === "ready"
```

### 4.3 Derived State & the Collection-Flag Rule

**The collection-flag rule (normative).** A run whose `resultConfig` collection flags don't match the requested outputs is a UX bug this architecture prevents **by construction**: the flags are *derived from the requested outputs*, not hand-set in the run context.

Requirements matrix (from Core Spec §9.4/§9.5, JS Profile §3.6–§3.8):

| Requested output | Requires |
|---|---|
| Errors (register) view | `collectCellRegister: true` |
| XLSX report export (`exportXlsx` / `exportComparisonXlsx`) | `collectCellRegister: true` |
| Annotated XLSX (`exportAnnotatedXlsx`; validate only) | `collectCellObservations: true` |
| Report / Summary views; comparison Diff grid | — (always produced: `summary`; `diff` is unconditional per Core Spec §15.10) |

Derivation, applied at `run/execute`:

```
effectiveResultConfig = authoredResultConfig            // from builder.build(), defaults implied
    with collectCellRegister     = authored || required-by-any-requested-output
    with collectCellObservations = authored || required-by-any-requested-output
runConfig = deepCopy(authoredConfig) with resultConfig replaced by effectiveResultConfig
```

- The **authored artifact is never modified** — the derivation happens on the run-time copy only, and `run.effectiveResultConfig` records what was sent.
- The Run panel shows the derivation *before* the run ("auto-enabled for this run: `collectCellRegister` (Errors view, XLSX report)"), so cost-bearing flags (both are O(rows×cols)-ish) are visible, and an author who set a flag explicitly sees it respected (`authored ||` — derivation only ever adds).
- The **export guard** is the dual: each exporter button is enabled only when `run.result` actually carries what it needs (`cellRegister` non-null, `cellObservations` non-null, `diff` present ⇒ comparison exporter). Because outputs are derived, a mismatch is unreachable through this UI; the guard exists so even a future code path (e.g. loading an externally produced result JSON) fails soft with a stated reason instead of a rejected Promise surfacing raw.
- Selecting **Annotated XLSX after a run** that lacked observations does not error: it flips `requestedOutputs`, marks the result stale-for-that-output, and surfaces "[Re-run] needed to produce observations".

## 5. Component Contracts

Component = plain function `(props, dispatch) → DOM` + a store subscription (§8). Props are read-only slices of `AppState`; all mutation is `dispatch(action)`. Contracts below are what another agent implements from; internal DOM structure is free.

| Component | Props (state read) | Emits (actions) | Contract highlights |
|---|---|---|---|
| **AppShell** | `ui.activeTab`, readiness predicates | `ui/setTab` | Owns header + rail + panel switching. Rail badges: ✓ `ready`, ⚠ with count (authoring errors / ingest warnings), ○ empty/off. Run tab badge shows `stale`. |
| **ConfigLibraryBar** | `configs.*`, `authoring.dirtySinceSave` | `config/load·create·save·import·download`, rename, delete, **copySectionFrom(id, sectionPath)** (§2.1) | Picker shows `name` + `updatedAt`; destructive ops confirm; unsaved-changes guard on switch. |
| **DataPanel** | `data.*`, `authoring.comparisonEnabled` | `data/ingest`, `data/clear(slot)`, `inference/run` | One `DataSlotCard` per slot; expected card rendered only when comparison enabled. |
| **DataSlotCard** | one `DataSlot` | `data/ingest(slot, …)`, `data/pasteText` | File pick **or paste** (a "Paste data" affordance opens a textarea; the pasted text becomes the ingest **source string** — CSV/TSV text or JSON, exactly the JS profile §3.12 string-source row, which also subsumes the §3.9 adapters) → **IngestSpecForm** (format confirm — suggested from extension, never sniffed; header mode; delimiter/quote/encoding; sheet; `skipRows`/`skipFooterRows` row-windowing fields; **normalization step-list editor** — per-table and per-column step lists with a function picker and params editor, rendered from `TableValidation.normalizationModel`, never a hard-coded function list; per-column-only functions are excluded from the table-level picker). On `ready`: provenance line (`format · encodingUsed · sheetName · rowCount×columnCount`, plus `normalized: <fn>×<count> (<column>)…` when a pipeline ran) + collapsible warnings list (code, message, count, coordinates). On `failed`: canonical `code` + detail rendered per §9. Re-upload stub after reload (§2.3). |
| **InferenceBanner** | `inference.*`, whether a config is active | `inference/run·accept·dismiss`, `schema/edit` | Exposes every `InferenceOptions` field (`sampleRows`, `suggestRanges`, `suggestPrecision` — observed decimal-precision bounds, default on, Addendum §C.7 — `seedComparison`, `allAcceptingFormats` — the mixed-format temporal switch, Addendum §C.4 — and `exhaustive` — whole-table inference, Addendum §C.2). Shows sample bound (`report.sample`), per-column `inferredType (confidence)` chips; expandable evidence table (§6 of the report: alternatives, nullTokensSeen, candidateKey); *Use draft* loads builder; *replace* path requires confirm. Download report JSON. **One-click adoption buttons** — each a *normal builder edit* against the ACTIVE config, instantly visible in authoring validation: "enable uniqueness on `<col>`" per candidate key; "apply tolerance ±x on `<col>`" per report-only tolerance suggestion (disabled while comparison is off, with the reason); "add `<token>` to nullEquivalents" for tokens observed in the sample but absent from the active config. |
| **SchemaPanel** | `authoring.*` | `schema/edit`, `schema/columnOp` | Master–detail (§3.1): column list (order = artifact order; drag → `moveColumn` — order is semantic, Core Spec §5.6) + table-settings accordion + **AuthoringResultPanel**. |
| **SettingField** (the workhorse) | one `SettingDescriptor` + current value + resolved preview | `schema/edit(path, value)` | Rendered per descriptor: `enum`→select, `bool`→checkbox, `Range`→min/max/inclusivity group, `StringMatchStrategy`→3 checkboxes, arrays→chip editors, etc. `NumberFormat[]` fields additionally carry the **example-to-format compiler** (1.3.0): the author types one example value (`(1 234,50)`), the compiled parametric format(s) are DISPLAYED before anything is committed (a genuinely ambiguous example like `1.234` compiles to both readings and the author picks), and an accept button appends to the formats array — UI sugar only, the schema stays parametric. Placeholder = default; *unset* affordance distinguishes "explicitly set" from "engine default" (sparse authoring, Addendum §A.5). `relevantWhen === false` (evaluated on `resolvedPreview()`) → collapsed/dimmed with the reason — mirroring the `irrelevantSetting` advisory. `dependsOn` violation → inline error anchored to the field. |
| **ColumnEditor** | column name + its descriptor subset | `schema/edit` | Type select first; type-block fields swap per `type.name` (descriptor `section: "type:*"`); per-column severity incl. `byRule` editor constrained to the rule names the column can emit (Core Spec rule 53). |
| **AuthoringResultPanel** | `authoring.lastValidation` | click-through → focus offending field | Renders `errors` (path/expected/actual — click focuses the field via path→component registry), `advisories`, and `deferred` badges with explanation ("checkable only with a function registry / timezone db", Addendum §A.4). |
| **ComparisonPanel** | `authoring.*` (comparison subset), column list | `comparison/toggle`, `schema/edit` | Master toggle; key picker (multi-select over columns); `setMode` and `onDuplicateKey` selects; per-field table (compare/presence/**expectedName** alias/tolerance/fuzzy — tolerance editor offers the four `ToleranceSpec` shapes); severity-map grid (tier × {none, warning, error}) with `setMode`-derived defaults shown as placeholders; scope + diffChecks editors. All fields are `SettingField`s over `comparison.*` descriptors. |
| **RunPanel** | `run.*`, readiness predicates, flag derivation preview | `run/setOutputs`, `run/setMessageTemplates`, `run/execute(mode)` | Output checkboxes → live "auto-enabled" line (§4.3); **message-template overrides** (a JSON map `{ ruleName: "template with {placeholders}" }`, the JS profile §3.5 localization/custom-wording seam) applied as `options.messageTemplates` on the run **and threaded to every exporter** so workbooks render the same wording — string templates only in the UI (function templates are API-only, not expressible in JSON); Validate/Compare buttons with disabled-reason tooltips (exact failed predicate); stale banner with Re-run. |
| **AdvancedCard** | `advanced.*`, `authoring.lastValidation.deferred` | `advanced/*` | The §9 custom-function panel on the Run tab: a prominent plain-language warning ("pasted code runs in this page with full access — paste only code you trust; per-session only, never saved or exported, off after reload"), the opt-in checkbox, name + source editors per function, compile errors inline. When the active config defers rule 30, the card states that enabling the mode (or the API) is the way to run it. |
| **ResultsView** | `run.result`, `run.report`, `ui.resultView`, `ui.filters` | `ui/setResultView`, `ui/setFilter`, `export(kind)` | Tab strip: Report · Summary · Errors · Diff (compare only) · Data · **Δ Delta** (when a previous run exists). Delegates to §6 views. **ExportBar** with per-exporter guards (§4.3). |

## 6. Result Presentation

All views reuse engine outputs **verbatim** — the console formats, filters, and lays out; it never reclassifies.

- **Report view** — `buildReport(result)` rendered exactly per Core Spec §9.3: the verdict one-liner (with the "(truncated at limit)" suffix when `truncated`), `needsAttention`, per-severity violation counts (`bySeverity` — violations, not entries), `checksFailed`, `columnsAffected`, `topIssues` (≤5, pre-sorted by the report). Abort state renders the §9.3 aborted line with `abortReason`.
- **Summary view** — one row per `summary.details` group: Severity · Phase · Check (`ruleName`) · Column (`fieldName`, `—` when null, `_schema` for advisories) · Message (`renderMessage(ruleName, context)`) · Count (entries) · First row (1-based display; JSON stays 0-based — Core Spec §9.4 convention) · Top samples (`v (×n)` joined). Sortable; default sort = severity rank → count desc (mirrors the XLSX Summary sheet).
- **Errors (register) view** — one row per `cellRegister` entry: # · Severity · Check · Column · Row (1-based) · Value (canonical string) · Message. **Filters** (chip bar, combinable): severity, `ruleName`, column, and — for comparison results — **Scope** (`in`/`out`, from `context.inScope`) and **Match Status** (`matched`/`fuzzyMatched`/`missing`/`unexpected`/`excludedDuplicateKey`, from `context.matchStatus` / `RowDiff.status`) — the same two filter dimensions the §15.11 sheets carry. Row click cross-navigates to the Data/Diff view cell.
- **Diff grid (compare only)** — one row per `diff.rows` entry (always complete, severity-independent — Core Spec §15.2/§15.10): leading **Match Status** and **Scope** columns, then compared columns. **Cell text = the rollup, always** (Core Spec §15.11 verbatim): `equal` → produced value; `equivalent` → `⚠ produced ≈ expected`; `different` → `✖ produced ≠ expected`, `[t]` appended only on interpreted-type-class difference. **Cell highlight = final (max) severity** over the cell's tier entry and any row-level diff-check entries touching it; `none` stays neutral — a cell can *say* "different" while un-tinted. Orphan rows tinted per their `rowMissing`/`rowUnexpected` severity. Hover/expand reveals the `CellDiff` measurements (`delta`, `tolerance`, `similarity`) without re-deriving anything. Virtualized rendering required (§8).
- **Data view** — the ingested produced table read-only, with per-cell tint from register entries (validation) grouped by (row, field) worst severity — the on-screen analogue of the §9.4 Data sheet. When the run collected observations, an **outcome legend** toggle switches tinting to the §9.5 outcome palette (native/interpreted/effectivelyNull/violation/skipped/notChecked) — the on-screen analogue of the annotated export.
- **Δ Delta view (run-to-run)** — the iterate-loop feature and the default view after a re-run of the same mode. Compares `run.previous` against `run.result`: verdict movement, per-severity violation-count movement, then violations keyed by **(ruleName, row, field)** partitioned into **new** / **resolved** / **unchanged** (register-derived; both runs need `cellRegister` — otherwise a grouped (severity, ruleName, field) count-movement fallback renders, with a hint to enable the Errors view). Lists cap at 200 rows with an honest note. Results live in memory only (§2.3) — the delta never survives a reload.
- **Exports** — the flag matrix of §4.3 governs enablement:

| Export | Source call | Needs |
|---|---|---|
| Validation XLSX | `exportXlsx({result, table, schema})` | `result.cellRegister` |
| Comparison XLSX | `exportComparisonXlsx({result, table, schema, expected})` | `result.diff` + `result.cellRegister` |
| Annotated XLSX | `exportAnnotatedXlsx({result, table, schema})` | `result.cellObservations` |
| Result JSON / Config JSON / Inference report JSON | serialization | — |

The `schema` passed to exporters is the **run config** (`run` snapshot), not the possibly-edited current draft — exporters re-derive the column mapping from it (JS Profile §3.6) and must see what the engine saw.

## 7. Persistence Model

`localStorage`, versioned envelope, two keys:

```
"tvconsole.v1.library" : { formatVersion: 1, entries: [ { id, name, updatedAt, config } ] }
"tvconsole.v1.session" : { formatVersion: 1, activeConfigId, activeTab, requestedOutputs, messageTemplates,
                           lastIngestSpec: { produced, expected },        // spec objects, not data
                           dataStubs: { produced, expected }              // fileMeta + provenance for re-upload prompts
                         }
```

- Write-through on every `config/save` and on session-relevant actions (debounced). Reads happen once at boot; a missing/older `formatVersion` triggers a defined migration or a clean fallback (never a crash, never silent partial state).
- Quota: configs are small (KBs); table data and results are excluded by design (§2.3). A failed write (quota, private mode) degrades to in-memory with a persistent notice — the console remains fully functional per session.
- Everything persisted is also exportable as files (§2.3), so `localStorage` is a convenience cache, never the only copy of user work — the UI nudges **Download** for anything older than the session when the user leaves with unsaved changes.
- **Workspace bundle** (header bar): one JSON file — active config, IngestSpec forms, data-slot provenance stubs (not the data), requested outputs, `referenceInstant`. Importing restores the session to "re-upload the file(s) and press Run"; the stub's saved IngestSpec form is reapplied when the file is re-picked. Advanced-mode sources are deliberately excluded (§9).
- **Multi-tab sync**: a `storage` event from another tab refreshes the config library in place (with a notice); the local unsaved draft is never clobbered.

## 8. No-Build Implementation Constraints

- **Delivery**: static files — one `console.html` plus hand-authored ES2020 IIFE scripts (`console/*.js`), loaded with `<script>` tags after the library and its CDN dependencies (Luxon, ExcelJS), exactly per JS Profile §2. No modules, no bundler, no framework, no JSX; works from `file://` like the test harness (JS Profile §9).
- **Rendering mechanism**: a minimal store implemented in-repo (~50 lines): `createStore(reducer)` with `getState/dispatch/subscribe`; components are plain functions re-invoked on relevant slice change (compare-by-reference; re-render replaces the component's root node). No virtual DOM — the result grids use incremental row rendering instead (below). This is an implementation *pattern requirement*, not a library dependency.
- **Virtualized grids**: Errors/Diff/Data views MUST render windowed rows (fixed row height + scroll offset math) — tables at the engines' scale (10⁵–10⁶ cells) cannot be materialized as DOM.
- **Workers**: `validate()`/`compare()` run in a Web Worker whenever the console is served over http(s) (feature-detected via `location.protocol` and `Worker` availability) and no advanced-mode custom-function registry is active — function registries cannot cross `postMessage`, so those runs stay on the main thread (the JS Profile §5 worker support otherwise covers it: no DOM APIs, `Blob` exists in workers). Routing is not gated by cell count. `validate()`/`compare()` **and** `ingest()` are worker-routed under the same protocol/registry gating (ingest has no registry hazard in the console — host normalization functions are a documented v1 exclusion); the exporters remain main-thread (a worker export op is a known 1.4.0 candidate). From `file://`, where workers are unavailable, everything falls back to the main thread. The store treats both paths identically (async actions); the UI thread only ever renders.
- **Security/CSP**: no `eval`; the `Function` constructor is used in exactly **one** place — compiling advanced-mode custom functions (§9), and only after the user's explicit per-session opt-in next to a plain-language warning. Everything else stays constructor-free. The console adds no globals beyond its own namespace (`TVConsole`).
- **Determinism affordance**: a hidden/dev setting can pin `referenceInstant` (JS Profile §3.2) so support/repro sessions can reproduce `T+/-N` results exactly.

**Implementation status & documented deviations.** `console.html` + `console/*.js` in this repository realize this architecture (store/actions per §4, descriptor-driven fields per §5, collection-flag derivation per §4.3, result views per §6, `localStorage` persistence per §7). Engine runs go through the **`dist/table-validation-worker.js` worker when the console is served over http(s)** (JS Profile §3.14); from `file://`, where workers are unavailable, they fall back to the main thread — acceptable at the console's target scale. One remaining documented deviation: the large grids use **filter-then-cap windowing** (first 500 rows with an explicit count note and the exports as the full-fidelity channel) rather than scroll-offset virtualization.

**Measured scale limits** (benchmark harness `test/bench.js`; details and raw numbers in the WASM feasibility note): `validate()` runs at roughly 10⁶ cells/second and `compare()` at 0.4–0.5×10⁶ up to 10⁶ cells. Interactive comfort in the console ends around **10⁶ cells** (~1–2 s per run); 10⁷-cell tables complete but take tens of seconds and ~1 GB of heap — worker execution keeps the UI responsive either way.

## 9. Errors, Empty States, Guardrails

- **Ingestion failures** render the canonical code with a targeted next step: `formatMismatch` → "check the format selection (nothing is auto-detected)"; `encodingUnsupported`/`decodingFailed` → point at the encoding field; `limitExceeded:<limit>` → show the limit and the offer to raise it in the IngestSpec form (never silently truncate — the limit exists to be visible, Addendum §B.6); `sheetNotFound` → list available sheet names.
- **Engine aborts are results, not errors** (JS Profile §3.10 rule of thumb): an aborted run renders through the Report view (§9.3 aborted line + `abortReason`), with the triggering `error` entry linked. Thrown `TableValidationConfigError` (a console defect or missing dependency global) renders as a distinct developer-facing notice.
- **Custom-function guardrail → advanced mode**: without a registry, a config referencing `fn` names validates as *deferred* rule 10:30, exports fine, and is **blocked from running** (the engines would abort `schemaInvalid` at Phase 1 — a guaranteed abort is a guardrail's job to pre-empt); the block message points at the escape hatch. The escape hatch is **advanced mode** (Run tab): a per-session panel where the user pastes function sources next to a plain-language warning ("this code runs in the page with full access — paste only code you trust"), compiled via the `Function` constructor **only after** the user enables the mode for the session. Sources are never persisted (not in `localStorage`, not in config exports, not in workspace bundles) and the mode is off after every reload. With the mode on, authoring validation receives the registry — rule 30 becomes a real check (a missing function is an error, not a deferral) — and runs execute on the **main thread** (function registries cannot cross the worker boundary, JS Profile §3.14).
- **Empty states** are directive: empty Data tab → the F1 fast path; empty Schema with data present → "Infer draft config or add columns"; Run tab before readiness → the exact unmet predicates, each linking to its tab.
- **Staleness** is tracked, never guessed: `run.stale` flips on any config edit or data replacement after a run; stale results stay fully viewable but carry the banner (§3.2 F5).

## 10. Out of Scope / Deferred

- Schema templates (Core Spec §14.2), multi-config batch runs, server/cloud persistence, collaborative editing.

## 11. Full-Surface Coverage (normative)

The console is the **full-functionality UI** for the library: an all-local static
implementation — one `console.html` plus hand-authored CSS and vanilla ES2020 scripts, no
npm, no node, no build step, dependencies loaded only from the CDN (§8) — through which
**every capability of the JS profile's public API is reachable**. This section is the
normative completeness requirement: when the profile gains a capability, this matrix (and
the UI behind it) must gain a row in the same change.

**Exclusions, stated exactly:** function-valued inputs are UI-expressible only where a
dedicated affordance exists (advanced mode, §9) — function-form `messageTemplates` and
programmatic host bindings remain API-only. The benchmark harness (`test/bench.html`), the
conformance suite (`test/index.html`), and the batch-inference standalone tool
(`batch-infer-standalone.html`) are separate pages by design, not console gaps.

| Public capability (JS profile) | UI affordance |
|---|---|
| `validate(schema, table, options)` §3.2 | Run tab → **Validate** (worker over http(s), main thread on `file://` or with a function registry) |
| `compare(schema, produced, expected, options)` §3.3 | Comparison master toggle + Run tab → **Compare**; expected data slot |
| `options.referenceInstant` | Run panel field (determinism/repro affordance, §8) |
| `options.functions` (custom checks, tolerance fns, diff checks) §4.3/§4.7 | **Advanced mode** (§9): per-session paste-in registry |
| `options.messageTemplates` §3.5 | Run panel **message-template overrides** (JSON map; threaded to exporters) |
| `buildReport(result)` §3.4 | Report view (§6) — verdict line rendered verbatim |
| `renderMessage(ruleName, context, templates?)` §3.5 | every message cell in Summary/Errors/Δ views; overrides via the template editor |
| `exportXlsx` / `exportComparisonXlsx` / `exportAnnotatedXlsx` §3.6–§3.8 | ExportBar with the §4.3 dual guards; templates threaded |
| result JSON / config JSON / workspace / inference report downloads | header bar + ExportBar + InferenceBanner |
| `adapters.fromArrays` / `fromObjects` §3.9 | subsumed by **paste-data** sources with `jsonArrays`/`jsonObjects` formats (§5 DataSlotCard) |
| `configModel` §3.11 | every settings form is rendered from it (§1 principle 3); relevance/dependency behavior included |
| `createConfigBuilder` — `set`/`unset`/`get`, column ops, `addCompositeKey`/`addRowCheck`/`addTableCheck`, `setComparison`, `validate()`, `build()`, `resolvedPreview()` §3.11 | Schema panel (master–detail + checks editors), Comparison toggle/panel, live AuthoringResultPanel (errors → focus, advisories, deferred badges), Download (sparse `build()`), the *resolved preview* section |
| exhaustive authoring errors (Addendum §A.4 req. 7) | AuthoringResultPanel lists all; rail badge counts them |
| `ingest(source, spec, options)` — all five formats, header modes incl. `explicit` names, delimiter/quote/encoding, sheet, `skipRows`/`skipFooterRows`, limits §3.12 | DataSlotCard: file pick **or paste**, full IngestSpecForm; provenance line renders every `SourceProvenance` field; warnings table |
| `IngestSpec.normalization` + `normalizationModel` (Addendum §B.8) | per-table/per-column **step-list editor** rendered from `normalizationModel`; `normalizationActions` counts in the provenance line |
| `options.normalizationFunctions` | not UI-registrable in v1 (same posture as §9 pre-advanced-mode: built-ins cover the UI path; host functions via the API) — the ONE deliberate coverage exception, listed here so it cannot be a silent gap |
| `inferConfig(table, options)` — `sampleRows`, `name`, `suggestRanges`, `suggestPrecision`, `seedComparison`, `allAcceptingFormats`, `exhaustive` §3.13 | InferenceBanner options row; evidence table; one-click adoption; Use-draft flow |
| comparison config — keys, `setMode`, `onDuplicateKey`, fuzzy, per-field `compare`/`presence`/`expectedName`/`tolerance`/`fuzzy`, severity map (incl. `duplicateMatchKey`), scope, diff checks §3.3 | ComparisonPanel (all `SettingField`s over `comparison.*` descriptors) |
| results — summary, register, `cellObservations`, comparison `diff` (incl. `excludedDuplicateKey`), run-to-run delta | the §6 views + filters |
| `VERSION` / `SPEC_VERSION` | header brand |
| worker wrapper §3.14 | automatic http(s) feature-detection (§8); protocol itself is not a user surface |
