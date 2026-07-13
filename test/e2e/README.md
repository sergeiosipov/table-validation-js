# Headless E2E drives (internal test tooling)

These scripts drive the **browser suite**, the **console**, the **worker page**, and the
**a11y/robustness checks** headlessly with Playwright. They are *test tooling*, not part
of the product: the product stays a no-toolchain vanilla-JS artifact; everything these
scripts open also works by hand in any browser (`test/index.html`, `console.html`,
`test/worker.html` over http).

Requirements: Python + [Playwright](https://playwright.dev/python/) with browsers
installed (`playwright install chromium firefox webkit`), e.g. via
`uv tool install playwright`. No npm, no node project.

| Script | What it verifies |
|---|---|
| `run_suite.py [browser] [--tz ZONE]` | opens `test/index.html` from `file://`, waits for `#summary`, exits non-zero on any fail/blocked. `--tz` runs the whole suite under a different browser timezone (host-TZ robustness — the vectors pin `timezone: "utc"` + `referenceInstant`, so results must not move). |
| `drive_console.py [browser]` | `file://` console flow: ingest (incl. the normalization editor state) → infer → accept → validate → results; run-to-run Δ view; undo/redo; advanced-mode block → unblock → main-thread run; workspace export/import round-trip; dialog machinery. |
| `drive_http.py [browser]` | serves the repo over http, then: `test/worker.html` protocol suite; console engines **via the worker**; **two-tab `localStorage` sync** (a save in tab 1 updates the library in tab 2 via the `storage` event); **axe-core accessibility scan** of the console's four tabs (serious/critical = fail) plus a keyboard-only pass over the primary flow. |
| `drive_batch_infer.py [browser]` | `file://` drive of `batch-infer-standalone.html` (engine loads from the pinned CDN tag — needs network): mixed multi-file pick (clean CSV, JSON records, unsupported extension, corrupt XLSX) → per-file outcomes; ZIP download unpacked and validated (configs parse, manifest names every input incl. failures); the combined XLSX unpacked and checked (Summary sheet first, with a full-width autofilter over all 21 columns, a freeze pane after the metadata columns, no wrapped cells, and fitted column widths, followed by one sheet per inferred file each carrying its own data-header autofilter plus type/nullable review dropdowns); folder pick over `docs/examples` with relative paths and an honest non-table failure. |

Cross-browser gate: each script accepts `chromium` / `firefox` / `webkit` — the release
runs all three (plus the Node runner and `release-check.js`).
