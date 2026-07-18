# Conformance coverage — Core Spec §9.1 rule names → covering test file

Run the suite by opening `test/index.html` in a browser (`file://` works; Luxon/ExcelJS load from CDN).
Every vector also runs through the purity harness (inputs deep-frozen) and the determinism harness
(each run executed twice, results must be deep-equal; pinned `referenceInstant`).

| Rule name (Core §9.1) | Covering vector file | Vector |
|---|---|---|
| `schemaValidationError` | [vectors/schema-phase.js](vectors/schema-phase.js) | missing meta; Range min>max (rule 13); unknown column ref (rule 28); regexFlags `g` (rule 24); byPosition trailing suffix (rule 42); bool overlap (rule 43); datetime component coverage (rule 21); comparison class (rule 34); NumberFormat `negativeStyle`/`pattern` schema-shape (rule 12, 1.3.0); `evaluation.twoDigitYearPivot` out of range (rule 58, 1.3.0) |
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
| `typeMismatch` | [vectors/cell.js](vectors/cell.js), [vectors/parser-negatives.js](vectors/parser-negatives.js), [vectors/temporal.js](vectors/temporal.js) | strict/non-strict, NumberFormat, bool lists, non-scalar cells, temporal formats; `negativeStyle` parentheses/trailingMinus, mixed sign-notation formats array, `pattern` grouping/decimal enforcement (cell.js, 1.3.0); `yy` exact-two-digit pin and six-digit `SSSSSS` fractional seconds (temporal.js, 1.3.0) |
| `rangeBreach` | [vectors/cell.js](vectors/cell.js), [vectors/temporal.js](vectors/temporal.js) | constraints `value`, `length` (code points), `precision`, temporal value ranges; pivot-mapped `yy` years (e.g. `61` → `1961`) feed the same value-range check as 4-digit years (temporal.js, 1.3.0) |
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
| IngestSpec rules I1–I13 (all violations collected, §9.2-shaped detail), inert-setting advisories | [vectors/ingest.js](vectors/ingest.js) |
| Limits fail fast (`limitExceeded:*`), `formatMismatch` | [vectors/ingest.js](vectors/ingest.js) |
| Normalization built-ins (§B.8): trim, caseFold, nullCoerce, reformatNumber, reformatTemporal, promoteNumber, promoteBool, stripAffix, replaceChars, fillDown (ordering, ragged rows) | [vectors/ingest.js](vectors/ingest.js) |
| Normalization ordering (table steps → column steps), headers never normalized, `normalizationActions` counts/order, absent unless a pipeline ran | [vectors/ingest.js](vectors/ingest.js) |
| Host-registered normalization functions; `normalizationFunctionError` / `normalizationFunctionContractViolation` faults | [vectors/ingest.js](vectors/ingest.js) |
| Normalization spec rules I8–I10 (unknown fn, table-level `fillDown`, param shapes, headerless position keys, unmatched-key advisory) | [vectors/ingest.js](vectors/ingest.js) |
| Raw-feed vs normalized-output validation story (ingest → normalize → validate) | [vectors/ingest.js](vectors/ingest.js) — needs Luxon |
| `skipRows`/`skipFooterRows` (I13, provenance counts, over-skip, headerless) | [vectors/ingest.js](vectors/ingest.js) |
| `comparison.fields.<col>.expectedName` (alias pairing, logical names in results, byPosition advisory) | [vectors/comparison.js](vectors/comparison.js) |
| `comparison.match.onDuplicateKey` (`abort` default unchanged; `reportAndExclude` group violation, key-global exclusion, severity map incl. `none`, dead-knob advisory) | [vectors/comparison.js](vectors/comparison.js) |
| First-class `decimal` type (§6.10, 1.6.0) — P2 core (float-parity acceptance/precision; exact value ranges incl. the `0.3000000000000000001`/2^46 breach-vs-float additivity proofs, exclusive bounds; scale-insensitive-but-exact unique/monotonic — ≥2^53 no longer collide, `1.5`==`1.50` still does; built-in comparison/conditionalRequired exact; sumEquals auto-exact + native `binary64FallbackRows`; compare() exact with no flag + `exactFallback`; rule 59 / rule C4 schema errors; inference `suggestions.types` pointer, draft unchanged) plus the P3 broad battery (1.6.0): formats-based acceptance (German-style grouping+decimal), `allowBareDecimal`, `hasPattern` fallback suppression, `strictType` advisory parity with float, `negativeStyle` parentheses/trailingMinus; exact-range coverage — inclusive/exclusive boundaries incl. one-ulp-of-text either side, the 2^46 2-dp class on both sides of both bounds, a ≥2^53 pair where decimal orders correctly but float mis-orders on a collapsed exclusive bound, negatives/-0/0 equality, native-cell ranges verdict-identical to float (no fallback disclosure needed); composite keys / duplicate row / duplicate column content with a decimal component (scale-variant merges, ≥2^53 stays distinct); monotonic all four directions; conditionalRequired at ≥2^53 magnitude; built-in comparison `<` plus mixed decimal/float operands (`operandDec`); sumEquals `expectedField`-only trigger, exact tolerance boundary, rule 59 both polarities; compare() decimal match keys, percent/field tolerance forms, interpretedMatch vs exact tiers, pair-level `exactFallback` (text-native/native-native/text-text) within one column's diffs, rule C4 both polarities, the `[b64]` XLSX tag on a decimal column (ExcelJS-gated, B112 precedent); cross-cutting determinism double-run, self-accepting hand-authored schema + `build()` round-trip idempotence, result JSON-safety (no BigInt leaks), and a float-byte-identity sweep (frozen baselines from three pre-existing float vectors, proving decimal's presence changed nothing float-side); builder Phase-1 authoring-time parity for rule 59 / rule C4; ingest normalization end-to-end (`reformatNumber` preserves exactness into a decimal boundary check, `promoteNumber` destroys it and `sumEquals` discloses every promoted row via `binary64FallbackRows`) | [vectors/decimal.js](vectors/decimal.js), [vectors/infer.js](vectors/infer.js), [vectors/authoring.js](vectors/authoring.js), [vectors/ingest.js](vectors/ingest.js) |
| Inference `allAcceptingFormats` (all-accepting drafts, union coverage for mixed formats, determinism) | [vectors/infer.js](vectors/infer.js) — needs Luxon |
| `allowBareDecimal` (1.2.0): normalization `reformatNumber` canonicalizes `".85"`/`"-.02"` to `"0.85"`/`"-0.02"`; inference drafts and self-validates `.85`-style floats | [vectors/ingest.js](vectors/ingest.js), [vectors/infer.js](vectors/infer.js) — needs Luxon |
| Mixed-padding date families / twin-reduction (1.1.0/1.2.0): unpadded `d.M.yyyy`/`d/M/yyyy` infer high-confidence; the unpadded "twin" of a padded family is reduced out of alternatives | [vectors/infer.js](vectors/infer.js) — needs Luxon |
| `suggestPrecision` (1.1.0): on by default, decoupled from `suggestRanges` | [vectors/infer.js](vectors/infer.js) |
| Digit-date guard (1.1.0): `yyyyMMdd`-shaped int columns keep the int ladder order but carry a ranked date alternative (`digitDate` reason) | [vectors/infer.js](vectors/infer.js) — needs Luxon |
| `twoDigitYearPivot` / `yy` candidates (1.3.0): two-digit-year columns infer `ambiguous` with reason `twoDigitYear`; drafts never emit the pivot (rule N4); `yy` family padding reduction; 4-digit years never reach `yy` candidates | [vectors/infer.js](vectors/infer.js) — needs Luxon; schema-side range check in [vectors/temporal.js](vectors/temporal.js) |
| `negativeStyle`/`pattern` (1.3.0): accounting `"(1,234.50)"` and SAP `"1234.50-"` columns infer the matching `negativeStyle`; mixed sign notations stay conservative (`string`, reason `numericLike`) | [vectors/infer.js](vectors/infer.js) |
| `SSSSSS` token (1.3.0): minute- and microsecond-precision datetime columns infer `yyyy-MM-dd HH:mm` / `yyyy-MM-dd HH:mm:ss.SSSSSS` | [vectors/infer.js](vectors/infer.js) — needs Luxon |
| Extended null tokens (1.3.0): `#N/A`, `None`, `--`, `n/a` adopted into `nullHandling.nullEquivalents` in fixed candidate order | [vectors/infer.js](vectors/infer.js) |
| `groupingAmbiguity` (1.3.0): `"1.234"`/`"1,234"`-shaped columns flag both the decimal and grouped-integer readings; any breaking value disambiguates silently | [vectors/infer.js](vectors/infer.js) |
| `leadingZeroInt`/`unsafeInt` data-loss guard (1.3.0): leading-zero ids (`"007"`) and magnitudes beyond `Number.isSafeInteger` infer `string` with a ranked numeric alternative rather than lose data silently | [vectors/infer.js](vectors/infer.js) |
| Categorical ratio 0.2 (1.3.0): a 3-distinct-value column now qualifies as `categorical` at 20 rows | [vectors/infer.js](vectors/infer.js) |
| `numericLike`/`temporalLike` honesty (1.3.0): structured-looking values that fail every candidate (unpadded times, month names, mixed sign notations) report `confidence: "fallback"` with an honest reason instead of a bare high-confidence string fallback | [vectors/infer.js](vectors/infer.js) — needs Luxon |

## Quality program (WS6)

| Requirement | Covering test file |
|---|---|
| Real-world file corpus: Excel shape (sharedStrings, shared formulas + cached results, date serials 1900, styled-empty used-range over-report), 1904 date system, inline strings (Sheets/LibreOffice), Excel UTF-8-BOM / ANSI CSVs, quoted DB dump (see [fixtures/README.md](fixtures/README.md) for genuine-file gaps) | [vectors/corpus.js](vectors/corpus.js) — XLSX parts need ExcelJS |
| Fuzz: CSV serialize→ingest round-trip identity; builder build→rebuild identity + engine parity over random valid configs; inference always Phase-1-valid + deterministic; **self-accepting invariant (added 1.2.1): when the sample covers the whole table, every inferred draft MUST validate that same sample with zero errors** — the permanent conformance property added after the strictType-derivation bug; random byte streams → table or canonical code only (seeded PRNG throughout) | [vectors/fuzz.js](vectors/fuzz.js) |
| Mutation-based builder/engine parity over every `configModel` descriptor (wrong type / out-of-enum / broken dependency → both sides reject, same offending path; skips whitelisted) | [vectors/mutation.js](vectors/mutation.js) — needs Luxon |
| Prototype pollution: `__proto__`/`constructor` keys through jsonClone, builder seed/build, ingest jsonObjects, compare — never pollute, survive as data | [vectors/quality.js](vectors/quality.js) |
| Docs-as-tests: Core §12/§15.12 defaults tables parsed from markdown and diffed against `configModel` (rule M2); JS profile §8 examples executed verbatim | [docs-tests.js](docs-tests.js) — via node-runner.js |
| Release gate: version consistency everywhere, markdown anchors/links resolve, COVERAGE completeness, SRI hashes | [release-check.js](release-check.js) |

## Console (UI architecture v1.3.0)

| Requirement | Covering test file |
|---|---|
| Example→NumberFormat compiler (UI arch §5: preview-before-commit, dual-reading ambiguous compile): plain integer, ambiguous `1.234` two-format `ambiguous:true`, unambiguous two-separator European/US/apostrophe, bare decimal → `allowBareDecimal`, grouping-only integer, `parentheses`/`trailingMinus` negativeStyle, and the error branches (empty, too-many-separators, mid-string sign, grouping-not-in-threes). `compileNumberExample` is loaded DOM-free from `console/ui.js` into the headless harness | [vectors/console-compiler.js](vectors/console-compiler.js) |
| Console `+ example` button appends the compiled format to a column's `NumberFormat[]` array (never silently); dotted/bracketed inferred column-name guardrail warning after inference accept | [e2e/drive_console.py](e2e/drive_console.py) |

## Platform suites (JS profile §1/§2/§3.14/§9)

| Requirement | Covering artifact |
|---|---|
| Full corpus in Node ≥ 20 (same vectors, purity + determinism harnesses) + d.ts reflection check (every exported member declared) | [node-runner.js](node-runner.js) |
| Worker protocol §3.14: ping/init/validate/compare/ingest/inferConfig, structured-clone sanitization (temporal → ISO), error shape (name/code/detail), unknown op | [worker.html](worker.html) — serve over http |
| Performance envelope 10⁴–10⁷ cells (WASM-baseline + console scale limits) | [bench.js](bench.js) / [bench.html](bench.html) |
| Cross-browser gate (Chromium/Firefox/WebKit), console E2E flows (file:// main-thread + http worker), two-tab `localStorage` sync, axe-core a11y scan + keyboard pass, host-TZ robustness runs | [e2e/](e2e/README.md) drive scripts |
| `batch-infer-standalone.html` E2E drive: mixed multi-file pick (clean CSV, JSON records, unsupported extension, corrupt XLSX) → per-file outcomes; ZIP download (configs parse, manifest names every input incl. failures); combined XLSX — Summary sheet first with a full-width autofilter, a freeze pane after the metadata columns, no wrapped cells, fitted column widths, followed by one sheet per inferred file each with its own data-header autofilter plus type/nullable review dropdowns; folder pick over `docs/examples` with relative paths and an honest non-table failure | [e2e/drive_batch_infer.py](e2e/drive_batch_infer.py) |
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
