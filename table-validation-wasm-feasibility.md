# ADR: Rust→WASM High-Performance Profile — Feasibility Note

**Status:** investigated, **recommendation: NO-GO for v1.x** — ⚑ flagged as the user's call
(this note is the decision input, not the decision).
**Scope:** investigation only; nothing here is implemented.

## Context

The Browser JS profile is a single hand-authored ES2020 IIFE with a no-build/CDN
constraint. The question: would a Rust core compiled to WebAssembly, offered as an
**optional high-performance profile**, pay for itself?

## 1. Measured JS baseline

Harness: [`test/bench.js`](test/bench.js) / [`test/bench.html`](test/bench.html) — a
10-column "typical messy feed" (int id + uniqueness, regex/length strings, NumberFormat
floats with ranges, bool, categorical, ISO date via Luxon, skip), `strictType: false`,
~1% seeded defects, register off (the fixed-memory summary path). Deterministic PRNG;
`compare()` pairs on the id with a numeric tolerance and ~1% drift. One warm-up-free run
per size (cold numbers — the console's usage pattern).

| cells | rows | validate | compare | heap Δ |
|---|---|---|---|---|
| **Node v24 (V8, this machine)** | | | | |
| 10⁴ | 1 000 | 60 ms | 48 ms | 4 MB |
| 10⁵ | 10 000 | 158 ms | 278 ms | 16 MB |
| 10⁶ | 100 000 | 1.24 s | 2.6 s | 147 MB |
| 10⁷ | 1 000 000 | 12.8 s | 28.1 s | 1.4 GB |
| **Headless Chromium (same machine)** | | | | |
| 10⁴ | 1 000 | 64 ms | 42 ms | 2 MB |
| 10⁵ | 10 000 | 107 ms | 206 ms | 19 MB |
| 10⁶ | 100 000 | 1.04 s | 2.2 s | 77 MB |
| 10⁷ | 1 000 000 | 26.7 s | 88 s | 734 MB |

Observations:

- Throughput is roughly **10⁶ cells/second for `validate()`** and 0.4–0.5×10⁶ for
  `compare()` up to 10⁶ cells; scaling is near-linear until GC pressure bends the curve
  at 10⁷ in Chromium (validate 26.7 s, compare 88 s — allocation-bound, not CPU-bound).
- **Console scale limits** (recorded in the UI architecture spec §8): interactive
  comfort ends around **10⁶ cells** (~1–2 s per run through the worker); 10⁷ works but
  is a coffee-break run in a browser tab and takes ~0.7–1.4 GB of heap.
- The 10⁷ Chromium compare number is the only clearly *bad* data point, and it is
  dominated by the dense diff structure (O(rows) `RowDiff` objects each holding a
  per-column `CellDiff` map) — an allocation-shape problem, not a language problem.

## 2. What the spec already permits

Nothing in the spec set blocks a WASM profile: Core §1.6 defines profiles as
host-binding documents; a "Browser WASM profile" binding the same five capabilities
(regex, temporal, function registry, parsing, spreadsheet writer) would be conformant if
it passes the same vectors. The conformance corpus is deliberately language-agnostic
(JS profile §9) and would transfer as-is. `specVersion` stamping, the severity model,
and the result shapes are all language-independent.

Two bindings are genuinely hard in Rust/WASM:

- **Regex** — the normative dialect is ECMAScript. Rust's `regex` crate is a different
  dialect (no backreferences/lookbehind differences etc.); shipping `regress` (an
  ECMAScript-regex engine in Rust) or calling back into JS `RegExp` are both viable but
  each erodes either conformance confidence or the performance win.
- **Temporal** — Luxon semantics (token table, zone handling via ICU/Intl) would need
  `icu4x`-based reimplementation, the single riskiest divergence surface. Calling back
  to JS Luxon per cell would erase most of the gain on temporal-heavy tables.

## 3. Expected gains

Realistic (from typical JS→WASM migrations of string-heavy, allocation-heavy
workloads): **2–4×** on cell evaluation, more (5–10×) on the 10⁷-cell compare case if
the diff were restructured into columnar/flat buffers — but that restructuring is
exactly what would also fix the JS engine (see below). WASM's biggest structural win —
predictable memory without GC cliffs — matters only at the 10⁷ scale, which is beyond
the product's interactive envelope today.

Counterweight: crossing the JS↔WASM boundary with *strings* (every cell is a string in
the messy-feed case) has real serialization cost; naive ports often see <2× end-to-end.

## 4. Costs

- **Dual maintenance** of a ~5 000-line normative engine in two languages, with the
  spec's determinism guarantee ("same result, byte-equal") now a cross-language
  contract. Every future workstream (like this one's `onDuplicateKey`, `expectedName`,
  normalization built-ins) lands twice.
- **Toolchain** — the repo's defining constraint is *no build step*; a Rust core makes
  the artifact non-hand-authorable. The constraint could be scoped to the JS profile
  only (the WASM binary as a second, built artifact), but the "source and artifact are
  the same file" property is lost for that profile.
- **CDN/no-build loading** is solvable (a `.wasm` file next to the loader on jsDelivr,
  `WebAssembly.instantiateStreaming`; jsDelivr serves `application/wasm` correctly) —
  cost is a loader shim and an async initialization step the sync `validate()`/
  `compare()` API shape doesn't have today.
- **Conformance-vector reuse** is the one cheap part: the corpus is JSON-shaped and
  already runs from plain files.

## 5. Recommendation — ⚑ go/no-go is the user's call

**NO-GO for v1.x.** The JS engine's measured envelope (≈10⁶ cells/s validate,
sub-second at the console's realistic scale, linear to 10⁶) covers the product's
interactive use case with margin; the only weak data point (10⁷-cell compare in
Chromium) is an allocation-shape issue that a *JS-side* columnar diff would largely fix
for a fraction of the cost of a second engine. The dual-maintenance and
regex/temporal-binding risks attack the project's strongest properties — determinism,
single-file auditability, no toolchain.

**Reconsider if** any of these become real: (a) sustained >10⁷-cell server-side
workloads where minutes matter, (b) a second engine implementation is wanted anyway
(e.g. a Python profile) so the conformance corpus's cross-language value is already
being paid for, or (c) the diff/observation channels move to a columnar layout and
compare() is still the bottleneck.

**Cheaper first steps if 10⁷ matters soon:** columnar `CellDiff` storage (struct-of-
arrays), lazy `RowDiff.cells` materialization, and a streaming register — all inside
the existing JS profile, no new artifact kind.
