/* Table Validation — benchmark harness (WASM feasibility baseline + console scale limits).
 *
 * Runs tables of 10^4 / 10^5 / 10^6 / 10^7 cells through validate() and compare(),
 * reporting wall-clock timings and heap deltas. Dual-environment, no toolchain:
 *   Browser:  open test/bench.html (Chromium exposes performance.memory for heap numbers)
 *   Node:     node test/bench.js [maxCells]     (default 10000000)
 *
 * The workload is deliberately "typical messy feed": 10 columns — an int id with
 * uniqueness, strings with length/regex constraints, floats with a NumberFormat and a
 * range, a bool, a categorical, a date (only when Luxon is present) — strictType false,
 * ~1% seeded defects, register collection OFF (the fixed-memory summary path is the
 * scale-relevant one; the register is O(defects) anyway).
 */
'use strict';
(function (global) {
    const COLS = 10;

    function heapUsed() {
        if (typeof process !== 'undefined' && process.memoryUsage) return process.memoryUsage().heapUsed;
        if (global.performance && global.performance.memory) return global.performance.memory.usedJSHeapSize;
        return null;
    }

    function makeSchema(withDate) {
        return {
            meta: { schemaVersion: '1.0.0', name: 'bench' },
            nullHandling: { nullEquivalents: [''] },
            evaluation: { strictType: false, timezone: 'utc' },
            structure: { columnMatching: 'byName' },
            columns: {
                id: { type: { name: 'int' }, unique: { enabled: true } },
                code: { type: { name: 'string', length: { min: 2, max: 12, minInclusive: true, maxInclusive: true }, regex: '^[A-Z]{2}-\\d+$' } },
                amount: { nullable: true, type: { name: 'float', formats: [{ decimalSeparator: ',', groupingSeparators: [' '] }], value: { min: 0, max: 1e9, minInclusive: true, maxInclusive: true } } },
                qty: { type: { name: 'int', value: { min: 0, max: 100000, minInclusive: true, maxInclusive: true } } },
                active: { type: { name: 'bool' } },
                region: { type: { name: 'categorical', allowedValues: ['EU', 'UK', 'US', 'APAC'] } },
                day: withDate
                    ? { type: { name: 'date', formats: ['yyyy-MM-dd'] } }
                    : { type: { name: 'string' } },
                note: { nullable: true, type: { name: 'string' } },
                ratio: { type: { name: 'float', precision: { min: 0, max: 4, minInclusive: true, maxInclusive: true } } },
                tag: { type: { name: 'skip' } },
            },
            comparison: {
                match: { keys: ['id'] },
                fields: { amount: { tolerance: 0.01 } },
            },
        };
    }

    // deterministic PRNG (mulberry32) — reproducible tables, no Math.random
    function prng(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function makeTable(rows, withDate, defectRate, seed) {
        const rnd = prng(seed);
        const headers = ['id', 'code', 'amount', 'qty', 'active', 'region', 'day', 'note', 'ratio', 'tag'];
        const data = new Array(rows);
        const regions = ['EU', 'UK', 'US', 'APAC'];
        for (let i = 0; i < rows; i++) {
            const defect = rnd() < defectRate;
            data[i] = [
                String(i + 1),
                defect ? 'bad code!' : 'AB-' + ((i % 997) + 1),
                i % 17 === 0 ? '' : '1 234,' + String(10 + (i % 90)),
                String(i % 4001),
                i % 2 === 0 ? 'yes' : 'no',
                regions[i % 4],
                withDate ? '2026-' + String((i % 12) + 1).padStart(2, '0') + '-' + String((i % 28) + 1).padStart(2, '0') : 'd' + i,
                i % 5 === 0 ? '' : 'note ' + (i % 31),
                (i % 100) + '.' + String(i % 10),
                'x',
            ];
        }
        return { headers, rows: data };
    }

    async function runBench(opts, log) {
        const TV = global.TableValidation;
        const withDate = !!global.luxon;
        const maxCells = (opts && opts.maxCells) || 1e7;
        const sizes = [1e4, 1e5, 1e6, 1e7].filter((c) => c <= maxCells);
        const out = [];
        log(`table-validation ${TV.VERSION} benchmark — ${withDate ? 'temporal column ON (Luxon)' : 'temporal column OFF (no Luxon)'}`);
        log('cells      rows     validate(ms)  cmp(ms)    heapΔ(MB) verdict');
        for (const cells of sizes) {
            const rows = Math.round(cells / COLS);
            const schema = makeSchema(withDate);
            const table = makeTable(rows, withDate, 0.01, 42);
            const opts2 = { referenceInstant: '2026-07-08T12:00:00Z' };

            const h0 = heapUsed();
            let t0 = Date.now();
            const res = TV.validate(schema, table, opts2);
            const vMs = Date.now() - t0;
            const h1 = heapUsed();

            // compare: expected = same generator, different seed for ~1% cell drift
            const expected = makeTable(rows, withDate, 0.012, 43);
            t0 = Date.now();
            const cmp = TV.compare(schema, table, expected, opts2);
            const cMs = Date.now() - t0;

            const heapMb = h0 != null && h1 != null ? ((h1 - h0) / 1048576).toFixed(1) : 'n/a';
            log(`${String(cells).padStart(9)} ${String(rows).padStart(8)} ${String(vMs).padStart(12)} ${String(cMs).padStart(9)} ${String(heapMb).padStart(11)} ${res.valid ? 'valid' : 'invalid'}/${cmp.valid ? 'valid' : 'invalid'}`);
            out.push({ cells, rows, validateMs: vMs, compareMs: cMs, heapDeltaMb: heapMb, env: typeof process !== 'undefined' ? 'node' : 'browser' });
        }
        return out;
    }

    global.__tvBench = runBench;

    // Node entry point
    if (typeof process !== 'undefined' && typeof require === 'function' && typeof module !== 'undefined') {
        const path = require('path');
        const fs = require('fs');
        const vm = require('vm');
        globalThis.window = globalThis;
        const root = path.join(__dirname, '..');
        (async () => {
            // best-effort Luxon (same cache as node-runner)
            const os = require('os');
            const cached = path.join(os.tmpdir(), 'table-validation-node-deps', 'luxon.min.js');
            if (fs.existsSync(cached)) vm.runInThisContext(fs.readFileSync(cached, 'utf8'), { filename: cached });
            vm.runInThisContext(fs.readFileSync(path.join(root, 'dist', 'table-validation.js'), 'utf8'), { filename: 'table-validation.js' });
            const maxCells = process.argv[2] ? Number(process.argv[2]) : 1e7;
            await runBench({ maxCells }, (line) => console.log(line));
        })();
    }
})(globalThis);
