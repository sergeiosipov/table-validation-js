/* Quality program — property/fuzz tests (WS6 item 2). Seeded PRNG (mulberry32) for
 * full reproducibility: every failure message carries the seed. */
'use strict';
(function () {
    const U = window.__UNIT__;
    const suite = 'fuzz';
    const TV = () => window.TableValidation;

    function prng(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
    const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // ---------------- 1. CSV serialize → ingest round-trip identity ----------------

    const NASTY = ['', 'a', 'b c', '  pad  ', ',', ';', '"', '""', 'a,b', 'a"b', 'line\nbreak',
        'cr\rreturn', 'crlf\r\nboth', 'ünïcødé', '👍', 'NA', '-', '0', '3.14', 'true',
        '=SUM(A1)', "'quote", '\t tab', 'trailing,'];

    function serializeCsv(rows, delim, quote) {
        const q = (f) => {
            if (f.includes(delim) || f.includes(quote) || f.includes('\n') || f.includes('\r')) {
                return quote + f.split(quote).join(quote + quote) + quote;
            }
            return f;
        };
        return rows.map((r) => r.map(q).join(delim)).join('\r\n');
    }

    U.push({
        suite, name: 'CSV: serialize → ingest round-trip identity (seeded, nasty fields)',
        fn: async ({ assert }) => {
            for (let seed = 1; seed <= 20; seed++) {
                const rnd = prng(seed * 7919);
                const delim = pick(rnd, [',', ';', '\t', '|']);
                const cols = 1 + Math.floor(rnd() * 6);
                const rows = [];
                const nRows = 1 + Math.floor(rnd() * 12);
                for (let r = 0; r < nRows; r++) {
                    const row = [];
                    for (let c = 0; c < cols; c++) row.push(pick(rnd, NASTY));
                    rows.push(row);
                }
                // a row whose LAST field ends the file unquoted-empty is indistinguishable
                // from a trailing separator by construction — pin the last cell non-empty
                if (rows[nRows - 1][cols - 1] === '') rows[nRows - 1][cols - 1] = 'x';
                const text = serializeCsv(rows, delim, '"');
                const r = await TV().ingest(text, {
                    format: 'csv', header: { mode: 'none' }, csv: { delimiter: delim },
                });
                // mixed \r / \r\n inside UNQUOTED fields cannot round-trip (they are record
                // separators); our serializer quotes them, so identity must hold exactly.
                assert(deepEq(r.table.rows, rows),
                    `seed ${seed}: round-trip mismatch\nwant ${JSON.stringify(rows)}\ngot  ${JSON.stringify(r.table.rows)}`);
            }
        },
    });

    // ---------------- 2. builder build → rebuild identity over random valid configs ----------------

    function randomConfig(rnd) {
        const types = ['string', 'int', 'float', 'bool', 'categorical', 'skip', 'date', 'datetime', 'time'];
        const TEMPORAL_FORMATS = {
            date: ['yyyy-MM-dd', 'yy-MM-dd'],
            datetime: ['yyyy-MM-dd HH:mm', 'yy-MM-dd HH:mm'],
            time: ['HH:mm'],
        };
        const cfg = {
            meta: { schemaVersion: '1.0.0', name: 'fz' + Math.floor(rnd() * 1e6) },
            columns: {},
        };
        const nCols = 1 + Math.floor(rnd() * 5);
        for (let i = 0; i < nCols; i++) {
            const t = pick(rnd, types);
            const col = { type: { name: t } };
            if (rnd() < 0.5) col.nullable = rnd() < 0.5;
            if (rnd() < 0.3) col.severity = pick(rnd, ['error', 'warning']);
            if (rnd() < 0.3) col.unique = { enabled: rnd() < 0.5 };
            if (t === 'string' && rnd() < 0.5) col.type.length = { min: 0, max: 1 + Math.floor(rnd() * 40), minInclusive: true, maxInclusive: true };
            if (t === 'string' && rnd() < 0.3) col.type.regex = '^[a-z]+$';
            if (t === 'int' && rnd() < 0.5) col.type.value = { min: -100, max: 100 + Math.floor(rnd() * 100), minInclusive: true, maxInclusive: true };
            if (t === 'float' && rnd() < 0.4) col.type.precision = { min: 0, max: 2 + Math.floor(rnd() * 4), minInclusive: true, maxInclusive: true };
            if (t === 'categorical') col.type.allowedValues = ['A', 'B', 'C'].slice(0, 1 + Math.floor(rnd() * 3));
            // 1.3.0 NumberFormat union on numerics: negativeStyle / pattern / allowBareDecimal
            // (each round-trips through build→rebuild; grouping/decimal separators are declared so
            //  a chosen pattern only ever uses the four allowed symbols — see rule 12)
            if ((t === 'int' || t === 'float') && rnd() < 0.4) {
                const fmt = { decimalSeparator: '.', groupingSeparators: [','] };
                const k = rnd();
                if (k < 0.34) {
                    fmt.negativeStyle = pick(rnd, ['leadingSign', 'parentheses', 'trailingMinus']);
                } else if (k < 0.67) {
                    fmt.pattern = pick(rnd, t === 'int' ? ['#,##0', '000', '###'] : ['#,##0.00', '0.00', '###']);
                } else {
                    fmt.groupingSeparators = [];
                    fmt.allowBareDecimal = rnd() < 0.5;
                }
                col.type.formats = [fmt];
            }
            // temporal columns carry a format list; date/datetime may pin a column-level pivot
            if (t === 'date' || t === 'datetime' || t === 'time') {
                col.type.formats = [pick(rnd, TEMPORAL_FORMATS[t])];
                if (t !== 'time' && rnd() < 0.4) col.evaluation = { twoDigitYearPivot: 1000 + Math.floor(rnd() * 8900) };
            }
            cfg.columns['c' + i] = col;
        }
        if (rnd() < 0.4) {
            cfg.resultConfig = { maxSamples: 1 + Math.floor(rnd() * 9) };
            if (rnd() < 0.5) cfg.resultConfig.collectCellRegister = rnd() < 0.5;
        }
        if (rnd() < 0.4) cfg.nullHandling = { nullEquivalents: ['', 'NA'].slice(0, 1 + Math.floor(rnd() * 2)) };
        if (rnd() < 0.4) {
            cfg.evaluation = { strictType: rnd() < 0.5, timezone: 'utc' };
            // 1.3.0 table-level two-digit-year pivot (range [1000, 9899])
            if (rnd() < 0.5) cfg.evaluation.twoDigitYearPivot = 1000 + Math.floor(rnd() * 8900);
        }
        if (rnd() < 0.3) {
            cfg.structure = { allowExtraColumns: rnd() < 0.5, allowMissingColumns: rnd() < 0.5 };
        }
        const colNames = Object.keys(cfg.columns);
        if (colNames.length >= 2 && rnd() < 0.3) {
            cfg.compositeKeys = [{ columns: colNames.slice(0, 2), nullsAllowed: rnd() < 0.5 }];
        }
        if (rnd() < 0.3) {
            cfg.comparison = { match: { keys: [colNames[0]] } };
            if (rnd() < 0.5) cfg.comparison.match.setMode = pick(rnd, ['exact', 'superset', 'subset']);
            if (rnd() < 0.4) cfg.comparison.match.onDuplicateKey = pick(rnd, ['abort', 'reportAndExclude']);
        }
        return cfg;
    }

    U.push({
        suite, name: 'builder: build → rebuild round-trip identity over random valid configs',
        needsLuxon: true,   // generated configs include temporal columns (engine validate needs Luxon)
        fn: ({ assert }) => {
            for (let seed = 1; seed <= 30; seed++) {
                const rnd = prng(seed * 104729);
                const cfg = randomConfig(rnd);
                const a = TV().createConfigBuilder(cfg).validate();
                assert(a.valid, `seed ${seed}: generated config not valid: ${JSON.stringify(a.errors)}`);
                const b1 = TV().createConfigBuilder(cfg).build();
                const b2 = TV().createConfigBuilder(b1).build();
                assert(deepEq(b1, b2), `seed ${seed}: build → rebuild not identical`);
                // and the engine agrees the config is clean (parity with the builder)
                const run = TV().validate(b1, { headers: Object.keys(cfg.columns), rows: [] });
                assert(run.abortReason !== 'schemaInvalid', `seed ${seed}: engine disagrees with builder`);
            }
        },
    });

    // ---------------- 3. inference: always Phase-1-valid drafts, run-to-run deterministic ----------------

    U.push({
        suite, name: 'inference: random tables always yield Phase-1-valid, self-accepting, deterministic drafts',
        fn: ({ assert }) => {
            const CELLS = ['x', '1', '2.5', '1,5', 'true', 'no', 'NA', '', null, 7, 2.25, true, false,
                'AB-1', '2026-07-01', '01.07.2026', '12:30', '👍', '  pad ', '-', 'NULL', '1e5', '0', NaN,
                '30/06/19', '(1,234.50)', '1234.50-', '007', '#N/A', 'None', '--', '1.234', '9:05',
                '9007199254740993', '2026-07-15 14:30', '.85', '-.5'];
            for (let seed = 1; seed <= 25; seed++) {
                const rnd = prng(seed * 65537);
                const cols = 1 + Math.floor(rnd() * 6);
                const useHeaders = rnd() < 0.7;
                const headers = useHeaders ? Array.from({ length: cols }, (_, i) => 'h' + i) : null;
                const nRows = Math.floor(rnd() * 40);
                const rows = [];
                for (let r = 0; r < nRows; r++) {
                    const row = [];
                    const width = rnd() < 0.1 ? Math.floor(rnd() * cols) : cols;   // occasional ragged row
                    for (let c = 0; c < width; c++) row.push(pick(rnd, CELLS));
                    rows.push(row);
                }
                const table = { headers, rows };
                const opts = { allAcceptingFormats: rnd() < 0.5, suggestRanges: rnd() < 0.3, seedComparison: rnd() < 0.3 };
                const r1 = TV().inferConfig(table, opts);
                const r2 = TV().inferConfig(table, opts);
                assert(deepEq(r1, r2), `seed ${seed}: inference not deterministic`);
                const a = TV().createConfigBuilder(r1.draft).validate();
                assert(a.valid, `seed ${seed}: draft violates Phase 1 (rule N1): ${JSON.stringify(a.errors)}`);
                // §C.1 self-accepting invariant (named in 1.2.1): the sample covers the whole
                // table here, so the draft MUST validate it with zero errors — this is the
                // property whose absence let the strictType derivation bug ship
                const run = TV().validate(r1.draft, table);
                assert(run.valid && !run.aborted,
                    `seed ${seed}: draft does not validate its own sample (self-accepting invariant): ` +
                    JSON.stringify((run.summary.details || []).slice(0, 5)));
            }
        },
    });

    // ---------------- 4. random byte streams into ingest: canonical outcomes only ----------------

    U.push({
        suite, name: 'ingest: random byte streams never crash — a table or a canonical code',
        fn: async ({ assert }) => {
            for (let seed = 1; seed <= 25; seed++) {
                const rnd = prng(seed * 31337);
                const n = Math.floor(rnd() * 400);
                const bytes = new Uint8Array(n);
                for (let i = 0; i < n; i++) bytes[i] = Math.floor(rnd() * 256);
                // csv with auto encoding: must always resolve (windows-1252 accepts all bytes)
                try {
                    const r = await TV().ingest(bytes, { format: 'csv' });
                    assert(Array.isArray(r.table.rows), `seed ${seed}: csv resolved without a table`);
                } catch (e) {
                    assert(e && e.name === 'TableValidationIngestError' && typeof e.code === 'string',
                        `seed ${seed}: csv threw a non-canonical error: ${e && e.name}: ${e && e.message}`);
                }
                // the same bytes as declared xlsx / json: only canonical fatal codes allowed
                for (const format of ['jsonArrays', 'jsonObjects']) {
                    try {
                        await TV().ingest(new TextDecoder('windows-1252').decode(bytes), { format });
                    } catch (e) {
                        assert(e && e.name === 'TableValidationIngestError' && typeof e.code === 'string',
                            `seed ${seed}: ${format} threw non-canonically: ${e && e.name}: ${e && e.message}`);
                    }
                }
                if (window.ExcelJS) {
                    try {
                        await TV().ingest(bytes, { format: 'xlsx' });
                    } catch (e) {
                        assert(e && e.name === 'TableValidationIngestError' && typeof e.code === 'string',
                            `seed ${seed}: xlsx threw non-canonically: ${e && e.name}: ${e && e.message}`);
                    }
                }
            }
        },
    });
})();
