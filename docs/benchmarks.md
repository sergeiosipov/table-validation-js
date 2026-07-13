# Benchmarks — measured engine performance

Measured numbers for `validate()` and `compare()` at four table sizes, in both official
runtimes. Benchmarks are machine-dependent: treat the shape of the curve as the finding
and the absolute milliseconds as one data point (the Node table below was refreshed
2026-07-13 on a Windows 11 x64 development machine at the v1.3.0 tip, superseding the
2026-07-12 baseline; the Chromium table is still the 2026-07-12 measurement and is
pending its own refresh — rerun the harness on yours in the meantime, it takes minutes
and needs no toolchain).

## The workload

The harness ([`test/bench.js`](../test/bench.js) / [`test/bench.html`](../test/bench.html))
runs a deliberately *typical messy feed*, not a best case: 10 columns — an `int` id with
uniqueness, strings with length/regex constraints, a `float` with a regional
`NumberFormat` and a value range, an `int` with a range, a `bool`, a `categorical`, an
ISO `date` (through Luxon), free-text and `skip` columns — `strictType: false`, ~1%
seeded defects (so every run exercises the violation paths; the `invalid` verdicts are
by design), deterministic PRNG data, register collection off (the fixed-memory summary
path — the register is O(defects) on top). `compare()` pairs rows on the id with a
numeric tolerance and ~1% drift. Timings are cold, one run per size — the console's
usage pattern, no warm-up flattery.

## Results

**Node v24 (V8):** `node test/bench.js` — refreshed 2026-07-13 at the v1.3.0 tip (temporal
column on, Luxon loaded). The numbers are flat versus the 2026-07-12 baseline — no
regression — despite v1.3.0 adding the `luxParseFormat` regex layer and expanding
`interpretNumberFormat` to its 7-step algorithm (§3.5).

| cells | rows | validate | compare | heap Δ |
|---|---|---|---|---|
| 10⁴ | 1 000 | 67 ms | 46 ms | 3.3 MB |
| 10⁵ | 10 000 | 155 ms | 270 ms | 15.9 MB |
| 10⁶ | 100 000 | 1.21 s | 2.59 s | 146.0 MB |
| 10⁷ | 1 000 000 | 13.4 s | 27.7 s | 1.41 GB |

**Headless Chromium (same machine):** `test/bench.html`

| cells | rows | validate | compare | heap Δ |
|---|---|---|---|---|
| 10⁴ | 1 000 | 48 ms | 36 ms | 2.0 MB |
| 10⁵ | 10 000 | 117 ms | 209 ms | 18.7 MB |
| 10⁶ | 100 000 | 1.05 s | 2.16 s | 48.8 MB |
| 10⁷ | 1 000 000 | 29.9 s | 93.0 s | 739 MB |

## What the numbers mean

- **Throughput is roughly 10⁶ cells/second for `validate()`** and 0.4–0.5×10⁶ for
  `compare()`, near-linear up to 10⁶ cells in both runtimes.
- **The console's interactive comfort ends around 10⁶ cells** (~1–2 s per run; the UI
  architecture spec §8 records this limit). Served over http(s) the console runs the
  engines in a worker, so even long runs never freeze the page.
- **10⁷ cells works but is a coffee-break run**: scaling bends at that size — most
  visibly the Chromium `compare()` point — because the dense diff structure (one
  `RowDiff` per row, each holding per-column `CellDiff` objects) makes it
  allocation-bound rather than CPU-bound. Budget ~0.7–1.4 GB of heap at this scale.
- Validation is the cheaper operation; comparison roughly doubles-to-triples the cost
  at every size (it interprets both tables and materializes the diff).

## Reproducing

- **Browser, zero toolchain:** open [`test/bench.html`](../test/bench.html) — from disk
  or served; the page prints the same table. Heap deltas need Chromium
  (`performance.memory`; launch with `--enable-precise-memory-info` for precise values —
  the numbers above were captured that way).
- **Node:** `node test/bench.js [maxCells]` — e.g. `node test/bench.js 1000000` to skip
  the 10⁷ tier.

## A note on WASM

A Rust→WASM high-performance profile was investigated and **declined for v1.x**: the
measured JS envelope above covers the product's interactive scale with margin; the one
weak data point (10⁷-cell `compare()` in Chromium) is an allocation-shape issue a
JS-side columnar diff would largely fix; and a second normative engine would attack the
project's strongest properties — determinism, single-file auditability, no toolchain —
while the hardest bindings (ECMAScript regex, Luxon temporal semantics) are exactly the
riskiest to reimplement. The full ADR is preserved at the
[`v1.0.0` tag](https://github.com/sergeiosipov/table-validation-js/blob/v1.0.0/table-validation-wasm-feasibility.md).
