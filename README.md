# table-validation-js

The browser/Node **JavaScript implementation** of the Table Validation specification
set: a schema-driven, read-only table validation **and comparison** engine, its tooling
modules (ingestion with normalization, config authoring, config inference), and the
zero-install **Authoring & Run Console** with its [user guide](docs/user-guide.md).

Everything here is deliverable as static files: **browser + HTML + CSS + vanilla JS +
CDN — no npm, no node, no build step required to use any of it.** The language-agnostic
contracts (Core Specification, Authoring/Ingestion/Inference Addendum, Design-Decisions
Log) live in the companion spec repository
[`table-validation-spec`](https://github.com/sergeiosipov/table-validation-spec)
(private; see [Specs](#specs)). The JS-specific documents — the
[Browser JS profile](table-validation-js-impl-spec-v1.3.1.md) and the
[console UI architecture](table-validation-ui-architecture-v1.3.1.md) — live in this
repository.

[`dist/table-validation.js`](dist/table-validation.js) implements **Core Spec 1.3.1** in full
(`VERSION === SPEC_VERSION === "1.3.1"`): the validation engine, the `compare()` comparison engine,
the `{error, warning}` + abort severity model, per-rule/structural severities, `stopOnFail`/
`stopPolicy`, message-template overrides, cell observations, the XLSX / annotated / comparison
exporters — and the three tooling modules of the spec set's addendum: the **config meta-model &
builder** (`configModel`, `createConfigBuilder`), the **ingestion engine** (`ingest` —
CSV/TSV/XLSX/JSON → `TableInput`, with the opt-in **normalization pipeline**: trim,
case-fold, null-coercion, number/temporal reformatting, type promotion, `stripAffix`,
`replaceChars`, `fillDown`, plus host-registered functions), and **config inference**
(`inferConfig`). Verified by the in-repo conformance suite ([test/](test/)).

**No build step, no npm.** [`dist/table-validation.js`](dist/table-validation.js) is a single
hand-authored vanilla ES2020 IIFE — it is simultaneously the source and the distribution artifact.
It adds exactly one global, `TableValidation`, and never mutates its inputs. Two sibling
artifacts, both hand-authored and CDN-fetchable from the same tag:
[`dist/table-validation.d.ts`](dist/table-validation.d.ts) (TypeScript declarations for the full
public surface) and [`dist/table-validation-worker.js`](dist/table-validation-worker.js) (a
classic-worker wrapper proxying `validate`/`compare`/`ingest`/`inferConfig` over `postMessage` —
JS profile §3.14).

**Node.js ≥ 20 is officially supported** (JS profile §1): the library only reads `globalThis`,
so evaluating the same file in Node installs the same global; Luxon/ExcelJS are consumer-loaded
exactly as in the browser. [`test/node-runner.js`](test/node-runner.js) runs the full conformance
corpus in plain Node (no npm project).

## Zero-install delivery (restricted machines)

The intended consumer is a locked-down corporate machine with a browser, a network path
to `cdn.jsdelivr.net`, and nothing else — no npm, no node, no Python:

1. Download the release archive of the pinned tag
   (`https://github.com/sergeiosipov/table-validation-js/archive/refs/tags/v1.3.1.zip`)
   and unzip it anywhere — or copy the folder from any machine that can.
2. Double-click [`console.html`](console.html) — the full Authoring & Run Console, from
   `file://`. Double-click [`docs/user-guide.html`](docs/user-guide.html) — the user
   guide, rendered in the browser.
3. Double-click [`test/index.html`](test/index.html) if you want proof: the entire
   conformance suite runs in the browser, no server needed.

**Or send just one file.** When even a ZIP is too much (mail filters, USB policies),
two single-file variants pull everything else from the pinned CDN tag:

- [`console-standalone.html`](console-standalone.html) — the entire console in one file;
  the engine and console scripts load from `…@v1.3.1` on jsDelivr, each with a sha384
  `integrity` attribute, so a tampered CDN response is refused by the browser. Engines
  run on the main thread (a single file has no sibling worker script).
- [`docs/user-guide-standalone.html`](docs/user-guide-standalone.html) — the guide in one
  file; the 31 screenshots and the example CSVs load from the same immutable tag.
- [`batch-infer-standalone.html`](batch-infer-standalone.html) — **batch config
  inference**: pick many table files (or a whole folder — it recurses and filters to the
  supported extensions), infer one draft config per file, and download everything as one
  ZIP (`<file>.config.json` per success, optional `<file>.report.json` evidence, and a
  `manifest.json` naming every input with its outcome — failures included, never silently
  dropped) — or as one **combined XLSX review workbook**: a sheet per inferred file with
  the inferred column metadata (type, format, precision, nullable, confidence, sample
  evidence, candidate keys, alternatives) sitting above the full ingested data. Files are
  read locally in the browser and never leave the machine. This one is hand-authored
  (its UI *is* the file), with the engine pinned to the tag like the others; drafts are
  suggestions — review them in the console.

The first two are generated by [`docs/make-standalone.py`](docs/make-standalone.py) and
`test/release-check.js` fails the release if they drift from their sources (including
stale integrity hashes). Note that pages **cannot** be opened from `cdn.jsdelivr.net`
URLs directly — jsDelivr serves HTML as plain text by policy — which is exactly why
these files exist: the HTML travels to the machine, everything else rides the CDN.

The only network access any of these pages make is to `cdn.jsdelivr.net` (Luxon, ExcelJS,
and the guide's markdown renderer — each pinned and integrity-checked). To embed the
engine in your own page, use the pinned CDN URLs below. The Python/Node files under
[`test/`](test/) and [`docs/make-screenshots.py`](docs/make-screenshots.py) are internal
development tooling only — nothing in the product needs them.

## Load order

Dependencies are read from `globalThis` at call time only, so ordering relative to them is free:

```html
<script src="https://cdn.jsdelivr.net/npm/luxon@3/build/global/luxon.min.js"></script>   <!-- temporal columns only -->
<script src="https://cdn.jsdelivr.net/npm/exceljs@4/dist/exceljs.min.js"></script>       <!-- exportXlsx only -->
<script src="dist/table-validation.js"></script>
<!-- or pinned from the CDN with integrity checking (see "CDN & SRI" below):
<script src="https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@v1.3.1/dist/table-validation.js"
        integrity="sha384-dpBQTv5JJwb9sYAFI+ypp/fqKBrcVtwPmv3mRgBaVCfRyK1POem2OjC324d+kXi9" crossorigin="anonymous"></script> -->
```

## CDN & SRI (v1.3.1)

Tags are immutable — pin the exact version and verify it:

| Artifact | jsDelivr URL | `integrity` (sha384) |
|---|---|---|
| engine | `https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@v1.3.1/dist/table-validation.js` | `sha384-dpBQTv5JJwb9sYAFI+ypp/fqKBrcVtwPmv3mRgBaVCfRyK1POem2OjC324d+kXi9` |
| worker wrapper | `https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@v1.3.1/dist/table-validation-worker.js` | `sha384-Wsy3MrdLkR6US1HHtF8Ybd/Afz3+D8Uei3+6pa1h82aepwhUP5me064nIOUaF5br` |
| TypeScript declarations | `https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@v1.3.1/dist/table-validation.d.ts` | — (not `<script>`-loaded) |

`node test/release-check.js` recomputes these hashes; any post-tag fix ships as a new
patch tag (never re-tag changed content — CDNs cache exact-version URLs permanently).
Older pins keep working forever (tags are immutable). v1.1.0 added unpadded `d`/`M`
date tokens, wider date candidates with a digit-date guard, and `suggestPrecision`;
v1.2.0 adds `NumberFormat.allowBareDecimal` (`.85` as 0.85, opt-in), mixed-padding
date families with tightest-format-wins reduction, and exhaustive inference mode.
v1.2.1 fixes the inference `strictType` derivation (canonical conversion of
non-string cells in string columns counts as interpretation, so drafts always
validate their own sample — the §C.1 self-accepting invariant) and gives the
single-kind non-string fallback a report reason (`nonStringParticipants`).
v1.3.0 adds two-digit-year support (`yy` pinned to exactly two digits;
`evaluation.twoDigitYearPivot`, default 1961, column-overridable; yy inference
candidates always flagged ambiguous), accounting/SAP negatives
(`NumberFormat.negativeStyle`: parentheses / trailing minus) with an optional
CSVW-style `pattern` spelling contract, minute + microsecond (`SSSSSS`) datetime
candidates, extended null tokens (`#N/A`, `n/a`, `None`, `--`, …), data-loss
guards (leading-zero and unsafe integer strings infer string with a numeric
alternative), a grouping-ambiguity flag for `1.234`-shaped columns, categorical
recalibration, honest fallback confidence labels, the console's example-to-format
compiler, and a batch-tool review workbook with autofilter, auto-width, and
type/nullable dropdowns.

The engine core (structure, string/int/float/bool/categorical columns) works with neither
dependency present. A missing `luxon` only throws when a schema actually declares temporal
columns; a missing `ExcelJS` only when `exportXlsx` is called.

## Usage

```html
<script>
const schema = {
    meta: { schemaVersion: "1.0.0", name: "deliveries" },
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

console.log(TableValidation.buildReport(result).verdict);   // "passWithWarnings"

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

API surface: `TableValidation.validate(schema, table, options)`,
`compare(schema, produced, expected, options)`, `buildReport(result)`,
`renderMessage(ruleName, context, templates?)`,
`exportXlsx` / `exportComparisonXlsx` / `exportAnnotatedXlsx` (each Promise\<Blob\>),
`adapters.fromArrays` / `adapters.fromObjects`,
`configModel` / `createConfigBuilder(seed?)`, `ingest(source, spec, options?)` (Promise\<IngestResult\>), `normalizationModel`,
`inferConfig(table, options?)`, `TableValidationConfigError`, `TableValidationIngestError`,
`VERSION` (`"1.3.1"`), `SPEC_VERSION` (`"1.3.1"`).

Rule of thumb: **thrown = you called the API wrong; violations in the result = the schema or
data is wrong.** Schema *content* errors surface as `schemaValidationError` violations with
`aborted: true`, never as exceptions. The one documented exception is `ingest()`: its product
*is* the table, so fatal ingestion conditions reject with a `TableValidationIngestError`
carrying a canonical `code` (JS profile §3.12).

## Messy-data cookbook

Real-world feeds are dirty in recurring ways. The map from mess to feature (each feature's
normative definition lives in the spec set's addendum — Addendum §B for ingestion and
normalization, §C for inference):

| The mess | What handles it |
|---|---|
| **Leading-zero identifiers** (`"007"` must stay `"007"`) | declare the column `string` (an `int` column with `strictType: false` would interpret `"007"` as `7` — and collide with `"7"` under uniqueness) |
| **Scientific-notation / precision-mangled IDs** from Excel (`1.23457E+12`) | there is no un-mangling — the digits are gone. Prevent it upstream (format the column as text before export); a `string` column with a `regex` of `^\d+$` catches the damage at validation time |
| **Currency / percent affixes** (`"$ 1,200"`, `"12 %"`, `"5kg"`) | normalization `stripAffix` (`prefixes`/`suffixes`, longest match first), then `reformatNumber`/`promoteNumber` |
| **Report titles / metadata above the header; totals rows below** | `IngestSpec.skipRows` / `skipFooterRows` (Addendum §B.4) — actual dropped counts land in provenance |
| **Merged / blank repeating keys** (un-pivoting: region written once per block) | normalization `fillDown` (per-column; `treatAsEmpty` for `"-"`-style placeholders) |
| **NBSP, en/em dashes, curly quotes** (Word/Excel artifacts) | normalization `replaceChars` with an exact substitution map |
| **Regional number separators** (`1.234,50`, `1 234,50`) — and **bare decimals** (`.85`) | `formats: [NumberFormat]` on int/float columns (accept without transforming; `allowBareDecimal: true` for `.85`-style values), or normalization `reformatNumber` (canonicalize; `.85` → `0.85`, lexical precision preserved) |
| **Mixed date spellings in one column** (`2026-07-15` next to `16.07.2026`) | list several `formats` on the temporal column — or let inference draft them with `inferConfig(…, { allAcceptingFormats: true })` (Addendum §C.4 union coverage) |
| **Null-token zoos** (`NA`, `N/A`, `null`, `-`, `""`) | `nullHandling.nullEquivalents` (recognition, no rewriting); inference adopts observed tokens into its draft; normalization `nullCoerce` when you want real nulls in the output |
| **Duplicate headers** | `structure.duplicateColumnNames.strategy` (`halt` / `rename` / `keepFirst`) |
| **Duplicate match keys in comparison** (a golden row matched by two produced rows) | `comparison.match.onDuplicateKey: "reportAndExclude"` — one `duplicateMatchKey` violation per key group, rows excluded (status `excludedDuplicateKey`), run continues (Core Spec §15.6); the default stays abort |
| **Renamed columns between systems** (expected table says `Betrag`, schema says `amount`) | `comparison.fields.<col>.expectedName` — pairing uses the alias on the expected side, results keep the logical name |
| **Wrong/unknown encodings** | ingestion's closed encoding chain (BOM → strict UTF-8 → windows-1252 fallback with a warning); explicit labels never fall back silently (Addendum §B.5) |

**Not handled, by design:** multi-valued cells (`"red; blue"` — split upstream; one value per cell is the input model), fuzzy row deduplication during *validation* (duplicate detection is exact/interpreted equality; fuzzy pairing exists only in the comparison engine), and recovering data Excel already destroyed (see the ID row above).

## The console

[`console.html`](console.html) is the **Authoring & Run Console** — the HTML interface
implementing the [UI architecture spec](table-validation-ui-architecture-v1.3.1.md) on top of the
engine and the tooling modules. Open it in any browser (`file://` works; Luxon/ExcelJS load
from CDN). New to it? Start with the **[user guide](docs/user-guide.md)** — task-oriented,
screenshot-verified, with worked examples in [`docs/examples/`](docs/examples/orders-raw.csv);
on a machine without a markdown viewer, open **[`docs/user-guide.html`](docs/user-guide.html)**.
Four stages, freely navigable:

1. **Data** — upload **or paste** a produced (and, with comparison on, an expected) table;
   confirm the IngestSpec (nothing is sniffed beyond a format suggestion); see provenance and
   ingest warnings; get an explicit **inference offer** with per-column evidence (every
   `InferenceOptions` field exposed, incl. `allAcceptingFormats`).
2. **Schema** — the config builder UI. Every settings form is **rendered from
   `TableValidation.configModel`** (no hand-maintained settings list); irrelevant settings dim
   with the reason; authoring errors/advisories/deferred rules show live.
3. **Comparison** — a master toggle that *is* the `comparison` section, plus match keys, fuzzy,
   per-column options, the severity map, scope, and diff checks.
4. **Run & Results** — collection flags are **derived from the requested outputs** (a run whose
   flags don't match its outputs is unreachable); results reuse engine outputs verbatim:
   the report, summary, filterable errors view (scope/match-status for comparisons), the
   comparison diff grid (text = outcome, tint = severity), a tinted data view, the exporters —
   and a **Δ delta view** (default after a re-run): new / resolved / unchanged violations keyed
   by (ruleName, row, field), plus verdict and count movement. **Advanced mode** (explicit
   per-session opt-in, prominent warning) lets you paste custom check/tolerance functions and
   run configs that reference them; sources are never saved or exported and the mode is off
   after a reload. Served over http(s), engine runs go through the worker; `file://` runs on
   the main thread. The header bar has undo/redo and **workspace export/import** (config +
   ingest specs + data stubs + outputs — everything except the table data). A
   **messageTemplates** field on the Run panel (JSON map) applies the JS profile §3.5
   localization/custom-wording seam to the run and every exported workbook.

Saved configs live in `localStorage` (a library of named configs — export/import is bare,
engine-consumable JSON; a multi-tab `storage` listener keeps the library in sync). Table data
and results are never persisted; a re-upload stub reminds you what was loaded. Configs
referencing custom functions author and export fine; running them in-console needs the
explicit **advanced mode** on the Run tab.

## Running the tests

Open [`test/index.html`](test/index.html) in any browser — no server and no node required (it
loads scripts with a cache-busting query, so a plain reload always picks up edits). The suite
covers the validation golden vectors, the comparison-engine suite, and the module suites
(authoring, ingest incl. the normalization pipeline, infer — including ingest → infer →
author → run and raw-vs-normalized end-to-end flows). Luxon
and ExcelJS load from CDN; without network those suites report as *blocked* (never silently
skipped). Coverage of every Core Spec §9.1 rule name and the module requirements is mapped
in [`test/COVERAGE.md`](test/COVERAGE.md). Every vector runs through a purity harness (deep-frozen
inputs) and a determinism harness (two runs must be deep-equal, pinned `referenceInstant`,
`timezone: "utc"`; `T+/-N` vectors run at two instants).

The same corpus runs in **Node** via `node test/node-runner.js` (fetches the CDN dependency
bundles into a temp cache; blocked — never silently skipped — when offline). The Node run also
includes the **docs-as-tests** (the Core Spec's §12/§15.12 defaults tables parsed from the
markdown and diffed against `configModel`); those need the spec documents, which live in the
separate [`table-validation-spec`](https://github.com/sergeiosipov/table-validation-spec)
repository — the runner looks for a sibling checkout (`../table-validation-spec`) or the
`TV_SPEC_DIR` environment variable, and reports the check as *blocked* when neither is
present (the JS profile §8 examples are in-repo and always run). The worker protocol
has its own page, [`test/worker.html`](test/worker.html) (serve over http; workers don't exist on
`file://` pages). [`test/bench.html`](test/bench.html) / `node test/bench.js` is the performance
harness; measured numbers and scale guidance live in [`docs/benchmarks.md`](docs/benchmarks.md).

The quality program on top of the golden vectors: a **real-world file corpus** (Excel/1904/
inline-string XLSX shapes, regional CSVs — byte-embedded, see
[`test/fixtures/README.md`](test/fixtures/README.md)), **seeded fuzz/property suites** (CSV
round-trip, builder round-trip, inference validity/determinism, random-bytes ingestion),
**mutation-based builder/engine parity** over every `configModel` descriptor, a
**prototype-pollution check**, headless **E2E drives** ([`test/e2e/`](test/e2e/README.md)) run
cross-browser (Chromium/Firefox/WebKit) with two-tab sync, an axe-core accessibility scan, a
keyboard pass, and host-timezone robustness runs — plus
[`test/release-check.js`](test/release-check.js), the final version/anchors/coverage/SRI gate
before tagging.

## Implementation notes (interpretation decisions)

Where the specs leave latitude, this implementation chose:

- **Phase 1 stops at the first schema error in the engines** (the run aborts with
  `schemaInvalid`), so exactly one `schemaValidationError` is reported per run — while
  `createConfigBuilder().validate()` runs the same rule set in accumulate mode and reports
  **every independent Phase-1 defect in one pass** (`errors[0]` is the violation the engine
  would abort with; Addendum §A.4).
- **Builder deferred rules**: without an `options.functions` registry, function-existence checks
  are reported as deferred ids (`10:30`, `C5`, `C8`); IANA-zone validity (rule 4) is always
  checkable in this profile (Luxon when present, `Intl` otherwise), so it never defers.
- **`ingest()` is uniformly asynchronous** and rejects fatal conditions with
  `TableValidationIngestError` (`code` + `detail`); IngestSpec validation collects *all*
  I-rule violations in `detail` (unlike Phase 1's first-error behavior — a spec form is a
  small, flat surface where the complete list is cheap and more useful).
- **Inference formatted-number guard**: ladder step 4 requires *well-formed grouping*
  (1–3 digit lead, then exactly-3-digit groups) per Addendum §C.4 — without it, dotted dates
  like `01.07.2026` would read as integers and never reach temporal inference.
- **Temporal format validity (rule 48)** is checked with a token scanner over the normative Core
  Spec §13.3 token table (stricter than delegating to Luxon, which accepts more tokens; Core wins
  on behavior).
- **Duplicate headers under `rename`**: all instances are cell-validated under the schema column's
  rules (per Core Spec §5.5); Phases 7–9 read the first instance.
- **Composite keys whose column is absent from the table** are skipped (positional absence of an
  optional column).
- **Malformed custom-check return values** (non-array, bad shape, unknown field, out-of-range row)
  halt as `customFunctionError`; duplicate results halt as `customFunctionContractViolation`.
- Custom functions receive Luxon `DateTime` objects as the interpreted value of temporal cells.

## Specs

The specification set shares the unified version **1.3.1**, and
[`dist/table-validation.js`](dist/table-validation.js) implements it
(`VERSION === SPEC_VERSION === "1.3.1"`). The documents are split by audience:

**In this repository (JS-specific):**

- [Browser JS Implementation Specification v1.3.1](table-validation-js-impl-spec-v1.3.1.md) — API, bindings, packaging, incl. `configModel`/`createConfigBuilder`, `ingest`, `inferConfig` (§3.11–§3.13)
- [Authoring & Run Console — UI Architecture v1.3.1](table-validation-ui-architecture-v1.3.1.md) — the user-facing tool tying authoring/ingestion/inference to the engines; §11 is the normative **full-surface coverage matrix** — every public API capability mapped to a UI affordance, all-local static files, deps CDN-only
- [Benchmarks](docs/benchmarks.md) — measured `validate()`/`compare()` performance at 10⁴–10⁷ cells in Node and Chromium, scale guidance, and how to rerun the harness (browser, zero toolchain)

**In the companion spec repository** (language-agnostic, source of truth —
[`table-validation-spec`](https://github.com/sergeiosipov/table-validation-spec), currently
private, so these links require access):

- [Core Specification v1.3.1](https://github.com/sergeiosipov/table-validation-spec/blob/v1.3.1/table-validation-core-spec-v1.3.1.md) — behavior (normative), incl. the comparison engine (§15) and the §16 anchor for the addendum
- [Authoring, Ingestion & Inference Addendum v1.3.1](https://github.com/sergeiosipov/table-validation-spec/blob/v1.3.1/table-validation-authoring-tooling-addendum-v1.3.1.md) — normative core companion: config meta-model & builder (§A), `ingest()` + normalization pipeline (§B), `inferConfig()` (§C)
- [Design-Decisions Log](https://github.com/sergeiosipov/table-validation-spec/blob/v1.3.1/table-validation-design-decisions-v1.3.1.md) — non-normative record of every resolved ambiguity, with the genuine forks flagged

## License

[MIT](LICENSE).
