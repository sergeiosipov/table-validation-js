# Conformance coverage — Core Spec §9.1 rule names → covering test file

Run the suite by opening `test/index.html` in a browser (`file://` works; Luxon/ExcelJS load from CDN).
Every vector also runs through the purity harness (inputs deep-frozen) and the determinism harness
(each run executed twice, results must be deep-equal; pinned `referenceInstant`).

| Rule name (Core §9.1) | Covering vector file | Vector |
|---|---|---|
| `schemaValidationError` | [vectors/schema-phase.js](vectors/schema-phase.js) | missing meta; Range min>max (rule 13); unknown column ref (rule 28); regexFlags `g` (rule 24); byPosition trailing suffix (rule 42); bool overlap (rule 43); datetime component coverage (rule 21); comparison class (rule 34) |
| `irrelevantSetting` | [vectors/schema-phase.js](vectors/schema-phase.js) | byPosition name machinery + strict-mode formats infos |
| `headersMissing` | [vectors/structural.js](vectors/structural.js) | byName with null headers |
| `columnCountBreach` | [vectors/structural.js](vectors/structural.js) | byPosition too-few columns |
| `duplicateColumnName` | [vectors/structural.js](vectors/structural.js) | strategies `halt`, `rename`, `keepFirst` |
| `requiredColumnMissing` | [vectors/structural.js](vectors/structural.js) | byName (`expectedPosition: null`) and byPosition (position in context); halt-severity variant in the GATE 1 vector |
| `extraColumn` | [vectors/structural.js](vectors/structural.js) | byName (column-scoped) and byPosition (table-scoped) |
| `columnOrderViolation` | [vectors/structural.js](vectors/structural.js) | byName with `enforceColumnOrder` |
| `allNullColumn` | [vectors/structural.js](vectors/structural.js) | with `nullEquivalents` recognition |
| `duplicateColumnContent` | [vectors/structural.js](vectors/structural.js) | second column flagged, `duplicateOfColumn` context |
| `rowCountBreach` | [vectors/structural.js](vectors/structural.js) | table-scoped entry |
| `allNullRow` | [vectors/structural.js](vectors/structural.js) | row-scoped entry |
| `duplicateRow` | [vectors/structural.js](vectors/structural.js) | interpreted equality (`"01"` vs `1`) |
| `nullabilityViolation` | [vectors/cell.js](vectors/cell.js) | native null + null-equivalent string |
| `typeMismatch` | [vectors/cell.js](vectors/cell.js), [vectors/parser-negatives.js](vectors/parser-negatives.js), [vectors/temporal.js](vectors/temporal.js) | strict/non-strict, NumberFormat, bool lists, non-scalar cells, temporal formats |
| `rangeBreach` | [vectors/cell.js](vectors/cell.js), [vectors/temporal.js](vectors/temporal.js) | constraints `value`, `length` (code points), `precision`, temporal value ranges |
| `regexMismatch` | [vectors/cell.js](vectors/cell.js) | pattern + null flags |
| `categoryMismatch` | [vectors/cell.js](vectors/cell.js) | non-strict categorical with matchStrategy |
| `uniquenessViolation` | [vectors/aggregate.js](vectors/aggregate.js) | every occurrence incl. first; interpreted equality; `nullsEqual` both ways |
| `compositeKeyViolation` | [vectors/aggregate.js](vectors/aggregate.js) | 2 violations / 4 entries pattern |
| `compositeKeyNullViolation` | [vectors/aggregate.js](vectors/aggregate.js) | one entry per null key cell; `nullsAllowed: true` exclusion |
| `comparison:<name>` | [vectors/row-checks.js](vectors/row-checks.js) | two entries per fail; null/uninterpretable operands skipped |
| `conditionalRequired:<name>` | [vectors/row-checks.js](vectors/row-checks.js) | condition met + null target; null condition skips |
| `nonNullCount:<name>` | [vectors/row-checks.js](vectors/row-checks.js) | entry per listed field |
| `cooccurrence:<name>` | [vectors/row-checks.js](vectors/row-checks.js) | present/missing field split |
| `custom:<name>` (row) | [vectors/row-checks.js](vectors/row-checks.js) | warning severity, userMessage |
| `monotonic:<name>` | [vectors/table-checks.js](vectors/table-checks.js) | break at row N; null/uninterpretable skipped |
| `sequenceNoGaps:<name>` | [vectors/table-checks.js](vectors/table-checks.js) | kinds `gap`, `duplicate`, `belowStart` |
| `sumEquals:<name>` | [vectors/table-checks.js](vectors/table-checks.js) | 1 violation R×S entries; nulls as 0; `expectedField`/`tolerance` |
| `custom:<name>` (table) | [vectors/table-checks.js](vectors/table-checks.js) | (row, field) fails |
| `customFunctionError:<name>` | [vectors/row-checks.js](vectors/row-checks.js) | thrown error → halt |
| `customFunctionContractViolation:<name>` | [vectors/row-checks.js](vectors/row-checks.js), [vectors/table-checks.js](vectors/table-checks.js) | duplicate field / (row, field) results |

## Cross-cutting requirements

| Requirement | Covering vector file |
|---|---|
| GATE 1 (halt in Phase 4 skips 5–9) | [vectors/structural.js](vectors/structural.js) — "GATE 1" vector |
| GATE 2 (zero rows skip 6–9) | [vectors/structural.js](vectors/structural.js) — "GATE 2" vector |
| `maxErrors` circuit breaker | [vectors/breakers.js](vectors/breakers.js) |
| `maxErrorsPerColumn` + aggregates on checked rows | [vectors/breakers.js](vectors/breakers.js) |
| Both column-matching modes | byName throughout; byPosition in schema-phase, structural, unit (§8 example) |
| Null/uninterpretable policies (Core §7) | row-checks (comparison skip), table-checks (monotonic skip, sumEquals zero), aggregate (nulls in uniqueness/keys) |
| Violation vs entry counting | aggregate (composite key), row-checks (nonNullCount), table-checks (sumEquals) |
| Parser negatives (`"12abc"`, `""`, `" 1"`, `"1,2,3"`, `"1."`, `".5"`) | [vectors/parser-negatives.js](vectors/parser-negatives.js) |
| `T+/-N` at two pinned instants | [vectors/temporal.js](vectors/temporal.js) |
| Determinism (two runs deep-equal, pinned instant, utc) | every vector, via [runner.js](runner.js) |
| Purity (inputs deep-frozen) | every vector, via [runner.js](runner.js) |
| Config errors thrown vs violations recorded | [vectors/unit.js](vectors/unit.js) |
| Adapters, buildReport verdicts, exportXlsx contract, JS spec §8 example | [vectors/unit.js](vectors/unit.js) |

## Tooling modules (Addendum §A–§C, JS spec §3.11–§3.13)

| Requirement | Covering test file |
|---|---|
| `configModel` completeness/consistency signals (M1–M5), frozen data, JSON round-trip | [vectors/authoring.js](vectors/authoring.js) |
| Builder ↔ engine Phase-1 parity (M6): clean config never aborts `schemaInvalid`; same error path both ways | [vectors/authoring.js](vectors/authoring.js) |
| Exhaustive authoring errors (§A.4 req. 7): N independent defects → N errors in one pass; engine still abort-on-first with `errors[0]`'s path; fix-one-by-one convergence; C-rule defects included | [vectors/authoring.js](vectors/authoring.js) |
| Advisory preview mirrors `irrelevantSetting` contexts | [vectors/authoring.js](vectors/authoring.js) |
| Deferred rules (`10:30`, `C5`) — reported without a registry, checked with one, never silently passed | [vectors/authoring.js](vectors/authoring.js) |
| Sparse `build()`, canonical ordering, round-trip identity (M7), `resolvedPreview()` idempotence | [vectors/authoring.js](vectors/authoring.js) |
| Unknown-path rejection (M8); seed immutability; column ops; `intendedUse`; `setComparison(null)` | [vectors/authoring.js](vectors/authoring.js) |
| CSV/TSV grammar (RFC 4180 quoting, mixed separators, blank lines, ragged rows), header modes | [vectors/ingest.js](vectors/ingest.js) |
| Encoding chain (BOM sniff, strict UTF-8, windows-1252 fallback + warning; explicit `encodingUnsupported`/`decodingFailed`) | [vectors/ingest.js](vectors/ingest.js) |
| IngestSpec rules I1–I12 (all violations collected, §9.2-shaped detail), inert-setting advisories | [vectors/ingest.js](vectors/ingest.js) |
| Limits fail fast (`limitExceeded:*`), `formatMismatch` | [vectors/ingest.js](vectors/ingest.js) |
| Normalization built-ins (§B.8): trim, caseFold, nullCoerce, reformatNumber, reformatTemporal, promoteNumber, promoteBool, stripAffix, replaceChars, fillDown (ordering, ragged rows) | [vectors/ingest.js](vectors/ingest.js) |
| Normalization ordering (table steps → column steps), headers never normalized, `normalizationActions` counts/order, absent unless a pipeline ran | [vectors/ingest.js](vectors/ingest.js) |
| Host-registered normalization functions; `normalizationFunctionError` / `normalizationFunctionContractViolation` faults | [vectors/ingest.js](vectors/ingest.js) |
| Normalization spec rules I8–I10 (unknown fn, table-level `fillDown`, param shapes, headerless position keys, unmatched-key advisory) | [vectors/ingest.js](vectors/ingest.js) |
| Raw-feed vs normalized-output validation story (ingest → normalize → validate) | [vectors/ingest.js](vectors/ingest.js) — needs Luxon |
| `skipRows`/`skipFooterRows` (I13, provenance counts, over-skip, headerless) | [vectors/ingest.js](vectors/ingest.js) |
| `comparison.fields.<col>.expectedName` (alias pairing, logical names in results, byPosition advisory) | [vectors/comparison.js](vectors/comparison.js) |
| `comparison.match.onDuplicateKey` (`abort` default unchanged; `reportAndExclude` group violation, key-global exclusion, severity map incl. `none`, dead-knob advisory) | [vectors/comparison.js](vectors/comparison.js) |
| Inference `allAcceptingFormats` (all-accepting drafts, union coverage for mixed formats, determinism) | [vectors/infer.js](vectors/infer.js) — needs Luxon |

## Quality program (WS6)

| Requirement | Covering test file |
|---|---|
| Real-world file corpus: Excel shape (sharedStrings, shared formulas + cached results, date serials 1900, styled-empty used-range over-report), 1904 date system, inline strings (Sheets/LibreOffice), Excel UTF-8-BOM / ANSI CSVs, quoted DB dump (see [fixtures/README.md](fixtures/README.md) for genuine-file gaps) | [vectors/corpus.js](vectors/corpus.js) — XLSX parts need ExcelJS |
| Fuzz: CSV serialize→ingest round-trip identity; builder build→rebuild identity + engine parity over random valid configs; inference always Phase-1-valid + deterministic; random byte streams → table or canonical code only (seeded PRNG throughout) | [vectors/fuzz.js](vectors/fuzz.js) |
| Mutation-based builder/engine parity over every `configModel` descriptor (wrong type / out-of-enum / broken dependency → both sides reject, same offending path; skips whitelisted) | [vectors/mutation.js](vectors/mutation.js) — needs Luxon |
| Prototype pollution: `__proto__`/`constructor` keys through jsonClone, builder seed/build, ingest jsonObjects, compare — never pollute, survive as data | [vectors/quality.js](vectors/quality.js) |
| Docs-as-tests: Core §12/§15.12 defaults tables parsed from markdown and diffed against `configModel` (rule M2); JS profile §8 examples executed verbatim | [docs-tests.js](docs-tests.js) — via node-runner.js |
| Release gate: version consistency everywhere, markdown anchors/links resolve, COVERAGE completeness, SRI hashes | [release-check.js](release-check.js) |

## Platform suites (JS profile §1/§2/§3.14/§9)

| Requirement | Covering artifact |
|---|---|
| Full corpus in Node ≥ 20 (same vectors, purity + determinism harnesses) + d.ts reflection check (every exported member declared) | [node-runner.js](node-runner.js) |
| Worker protocol §3.14: ping/init/validate/compare/ingest/inferConfig, structured-clone sanitization (temporal → ISO), error shape (name/code/detail), unknown op | [worker.html](worker.html) — serve over http |
| Performance envelope 10⁴–10⁷ cells (WASM-baseline + console scale limits) | [bench.js](bench.js) / [bench.html](bench.html) |
| Cross-browser gate (Chromium/Firefox/WebKit), console E2E flows (file:// main-thread + http worker), two-tab `localStorage` sync, axe-core a11y scan + keyboard pass, host-TZ robustness runs | [e2e/](e2e/README.md) drive scripts |
| XLSX cell mapping (dates → zone-less ISO, formulas ± cached result, rich text, merged, error values), sheet selection, `sheetNotFound` | [vectors/ingest.js](vectors/ingest.js) — needs ExcelJS |
| Ingest/validate decoupling (ingest never judges) | [vectors/ingest.js](vectors/ingest.js) |
| Type ladder incl. formatted numbers (well-formed grouping), categorical thresholds, string fallbacks | [vectors/infer.js](vectors/infer.js) |
| Conservatism: "0"/"1" → int + ranked bool alternative; dotted dates are not numbers | [vectors/infer.js](vectors/infer.js) |
| Temporal inference + dd/MM vs MM/dd ambiguity policy | [vectors/infer.js](vectors/infer.js) — needs Luxon |
| Fixed null-token recognition, nullability, suggested `nullEquivalents` | [vectors/infer.js](vectors/infer.js) |
| Candidate keys report-only; comparison seeding opt-in (C1-minimal) | [vectors/infer.js](vectors/infer.js) |
| Rule N1 (every draft passes Phase 1), N6 (byPosition drafts omit `required`), sampling bound, determinism | [vectors/infer.js](vectors/infer.js) |
| `suggestRanges` observed bounds; report-only tolerance suggestions | [vectors/infer.js](vectors/infer.js) |
| ingest → infer → author → run end-to-end flow | [vectors/infer.js](vectors/infer.js) |
