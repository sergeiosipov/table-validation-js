/* Ingestion module — ingest() (Addendum §B, JS spec §3.12/§4.8). Async units. */
'use strict';
(function () {
    const U = window.__UNIT__;
    const suite = 'ingest';
    const TV = () => window.TableValidation;

    // await-able rejection assertion (fatal ingestion conditions reject with codes)
    async function expectCode(assert, promise, code, label) {
        try {
            await promise;
            assert(false, `${label}: expected rejection with code ${code}, but ingest resolved`);
            return null;
        } catch (e) {
            assert(e && e.name === 'TableValidationIngestError' && e.code === code,
                `${label}: expected TableValidationIngestError ${code}, got ${e && e.name}:${e && e.code}: ${e && e.message}`);
            return e;
        }
    }

    U.push({
        suite, name: 'csv: RFC 4180 grammar, provenance, empty fields stay ""',
        fn: async ({ assert, assertEq }) => {
            const r = await TV().ingest('a;b;c\n1;;3\n"x;1";"he said ""hi""";"line\nbreak"\r\n', {
                format: 'csv', csv: { delimiter: ';' },
            });
            assertEq(r.table.headers, ['a', 'b', 'c'], 'firstRow headers');
            assertEq(r.table.rows, [['1', '', '3'], ['x;1', 'he said "hi"', 'line\nbreak']],
                'quoting, escaped quotes, embedded delimiter and newline; empty field is "" not null');
            assertEq(r.source, {
                format: 'csv', encodingUsed: null, delimiter: ';', sheetName: null,
                rowCount: 2, columnCount: 3, headerMode: 'firstRow',
                skippedRows: 0, skippedFooterRows: 0,
            }, 'provenance');
            assertEq(r.warnings, [], 'no warnings');
            // determinism: same input twice → deep-equal results
            const r2 = await TV().ingest('a;b;c\n1;;3\n"x;1";"he said ""hi""";"line\nbreak"\r\n', {
                format: 'csv', csv: { delimiter: ';' },
            });
            assert(JSON.stringify(r) === JSON.stringify(r2), 'deterministic');
        },
    });

    U.push({
        suite, name: 'csv: record separators, blank lines kept, trailing separator dropped, ragged rows preserved',
        fn: async ({ assertEq }) => {
            const r = await TV().ingest('a\r\nb\rc\n\nd,e\n', { format: 'csv', header: { mode: 'none' } });
            assertEq(r.table.headers, null, 'headerless');
            assertEq(r.table.rows, [['a'], ['b'], ['c'], [''], ['d', 'e']],
                'CRLF/CR/LF mixed; blank line is a kept one-field empty row; trailing separator adds nothing');
            assertEq(r.source.columnCount, 2, 'columnCount = widest row; ragged rows preserved (validation is validate()\'s job)');
        },
    });

    U.push({
        suite, name: 'tsv: fixed TAB delimiter; csv.delimiter inert (advisory)',
        fn: async ({ assertEq }) => {
            const r = await TV().ingest('a\tb\n1\t2', { format: 'tsv', csv: { delimiter: ';' } });
            assertEq(r.table.rows, [['1', '2']], 'TAB-delimited');
            assertEq(r.source.delimiter, '\t', 'delimiter fixed to TAB');
            assertEq(r.warnings.length, 1, 'one advisory');
            assertEq(r.warnings[0].code, 'irrelevantIngestSetting', 'irrelevantIngestSetting');
        },
    });

    U.push({
        suite, name: 'header modes: none / explicit / firstRow canonical conversion',
        fn: async ({ assertEq }) => {
            const none = await TV().ingest('1,2\n3,4', { format: 'csv', header: { mode: 'none' } });
            assertEq(none.table, { headers: null, rows: [['1', '2'], ['3', '4']] }, 'mode none → byPosition-ready');
            const exp = await TV().ingest('1,2\n3,4', { format: 'csv', header: { mode: 'explicit', names: ['x', 'y', 'z'] } });
            assertEq(exp.table.headers, ['x', 'y', 'z'], 'explicit names verbatim (count mismatch is the engines\' business)');
            assertEq(exp.table.rows.length, 2, 'all parsed rows are data');
            const ja = await TV().ingest([[1, true, null], [2, false, 'x']], { format: 'jsonArrays' });
            assertEq(ja.table.headers, null, 'jsonArrays defaults to header.mode none');
            assertEq(ja.table.rows, [[1, true, null], [2, false, 'x']], 'JSON cells pass through typed');
            const jaH = await TV().ingest([['id', 'ok'], [1, true]], { format: 'jsonArrays', header: { mode: 'firstRow' } });
            assertEq(jaH.table.headers, ['id', 'ok'], 'firstRow headers canonical-converted');
        },
    });

    U.push({
        suite, name: 'encoding: BOM sniff, strict UTF-8, windows-1252 fallback, explicit failures',
        fn: async ({ assert, assertEq }) => {
            const enc = new TextEncoder();
            // UTF-8 BOM
            const withBom = new Uint8Array([0xEF, 0xBB, 0xBF, ...enc.encode('hé\n1')]);
            let r = await TV().ingest(withBom, { format: 'csv' });
            assertEq(r.source.encodingUsed, 'utf-8', 'BOM → utf-8');
            assertEq(r.table.headers, ['hé'], 'BOM stripped, never part of the first header');
            // UTF-16LE BOM
            const s = 'a\n1';
            const u16 = new Uint8Array(2 + s.length * 2);
            u16[0] = 0xFF; u16[1] = 0xFE;
            for (let i = 0; i < s.length; i++) { u16[2 + i * 2] = s.charCodeAt(i); u16[3 + i * 2] = 0; }
            r = await TV().ingest(u16, { format: 'csv' });
            assertEq(r.source.encodingUsed, 'utf-16le', 'FF FE → utf-16le');
            assertEq(r.table.rows, [['1']], 'utf-16 decoded');
            // plain UTF-8 without BOM (strict attempt succeeds)
            r = await TV().ingest(enc.encode('x\n€'), { format: 'csv' });
            assertEq(r.source.encodingUsed, 'utf-8', 'strict UTF-8 attempt');
            // invalid UTF-8 → windows-1252 fallback + warning
            r = await TV().ingest(new Uint8Array([0x68, 0x0A, 0xE9]), { format: 'csv' });
            assertEq(r.source.encodingUsed, 'windows-1252', 'single defined fallback');
            assertEq(r.table.rows, [['é']], '0xE9 → é under windows-1252');
            assertEq(r.warnings.map((w) => w.code), ['encodingFallback'], 'fallback is reported, never silent');
            // explicit encodings never fall back
            await expectCode(assert, TV().ingest(new Uint8Array([0xE9]), { format: 'csv', csv: { encoding: 'utf-8' } }),
                'decodingFailed', 'explicit utf-8 on bad bytes');
            await expectCode(assert, TV().ingest(new Uint8Array([0x61]), { format: 'csv', csv: { encoding: 'no-such-charset' } }),
                'encodingUnsupported', 'unsupported label');
        },
    });

    U.push({
        suite, name: 'ingestSpec validation (I-rules): all violations collected; fatal code carries §9.2-shaped detail',
        fn: async ({ assert, assertEq }) => {
            const e = await expectCode(assert, TV().ingest('a', {
                format: 'nope', header: { mode: 'weird' }, csv: { delimiter: ';;' }, limits: { maxRows: 0 }, bogus: 1,
            }), 'ingestSpecInvalid', 'invalid spec');
            assert(Array.isArray(e.detail) && e.detail.length >= 5, `collects every violation (got ${e.detail && e.detail.length})`);
            for (const d of e.detail) {
                assert('path' in d && 'expected' in d && 'actual' in d, 'detail entries use { path, expected, actual }');
            }
            // caller errors are thrown TableValidationConfigError, not ingest codes
            try {
                await TV().ingest({ not: 'a source' }, { format: 'csv' });
                assert(false, 'bad source type must reject');
            } catch (err) {
                assertEq(err.name, 'TableValidationConfigError', 'unsupported source type = caller error');
            }
        },
    });

    U.push({
        suite, name: 'limits fail fast — defined failure, never silent truncation',
        fn: async ({ assert }) => {
            await expectCode(assert, TV().ingest('a\n1\n2\n3', { format: 'csv', limits: { maxRows: 2 } }),
                'limitExceeded:maxRows', 'maxRows');
            await expectCode(assert, TV().ingest('a,b,c\n1,2,3', { format: 'csv', limits: { maxColumns: 2 } }),
                'limitExceeded:maxColumns', 'maxColumns');
            await expectCode(assert, TV().ingest('a,b\n1,2\n3,4', { format: 'csv', limits: { maxCells: 3 } }),
                'limitExceeded:maxCells', 'maxCells');
            await expectCode(assert, TV().ingest(new TextEncoder().encode('abcdefgh'), { format: 'csv', limits: { maxBytes: 4 } }),
                'limitExceeded:maxBytes', 'maxBytes (checked before decoding)');
        },
    });

    U.push({
        suite, name: 'jsonObjects: intrinsic headers (first-seen key union), missing keys → null',
        fn: async ({ assertEq }) => {
            const r = await TV().ingest([{ a: 1, b: 2 }, { b: 3, c: null }], { format: 'jsonObjects' });
            assertEq(r.table.headers, ['a', 'b', 'c'], 'first-seen key union');
            assertEq(r.table.rows, [[1, 2, null], [null, 3, null]], 'missing key → native null');
            assertEq(r.source.headerMode, 'intrinsic', 'intrinsic header mode');
            const withHeaderCfg = await TV().ingest('[{"a":1}]', { format: 'jsonObjects', header: { mode: 'none' } });
            assertEq(withHeaderCfg.warnings.map((w) => w.code), ['irrelevantIngestSetting'], 'I12: header config inert, advisory');
            assertEq(withHeaderCfg.table.headers, ['a'], 'JSON text source parsed');
        },
    });

    U.push({
        suite, name: 'skipRows / skipFooterRows: title and totals rows dropped around header handling',
        fn: async ({ assert, assertEq }) => {
            // report title + blank line above the real header; totals row at the bottom
            const csv = 'Quarterly Report\n\nid,amount\n1,10\n2,20\nTOTAL,30\n';
            const r = await TV().ingest(csv, { format: 'csv', skipRows: 2, skipFooterRows: 1 });
            assertEq(r.table.headers, ['id', 'amount'], 'header found after skipping title rows');
            assertEq(r.table.rows, [['1', '10'], ['2', '20']], 'totals row dropped from the tail');
            assertEq(r.source.skippedRows, 2, 'provenance: leading rows skipped');
            assertEq(r.source.skippedFooterRows, 1, 'provenance: footer rows skipped');
            assertEq(r.source.rowCount, 2, 'rowCount counts the remaining data rows');
            // skip more than available → everything dropped, actual counts reported
            const all = await TV().ingest('a\n1\n', { format: 'csv', skipRows: 9 });
            assertEq(all.table.headers, [], 'no rows left for the header');
            assertEq(all.source.skippedRows, 2, 'actual dropped count, not the requested 9');
            // headerless: skipRows drops parsed rows, footer drops trailing data rows
            const hl = await TV().ingest('x\n1\n2\n3\ny\n', { format: 'csv', header: { mode: 'none' }, skipRows: 1, skipFooterRows: 1 });
            assertEq(hl.table.rows, [['1'], ['2'], ['3']], 'headerless windowing');
            // I13: negative / non-int rejected
            const err = await expectCode(assert, TV().ingest('a\n1', { format: 'csv', skipRows: -1, skipFooterRows: 1.5 }),
                'ingestSpecInvalid', 'bad skip values');
            assertEq(err.detail.map((d) => d.path), ['skipRows', 'skipFooterRows'], 'I13 paths');
        },
    });

    U.push({
        suite, name: 'formatMismatch codes',
        fn: async ({ assert }) => {
            await expectCode(assert, TV().ingest('not json', { format: 'jsonArrays' }), 'formatMismatch', 'bad JSON text');
            await expectCode(assert, TV().ingest([{ a: 1 }], { format: 'jsonArrays' }), 'formatMismatch', 'objects in jsonArrays');
            await expectCode(assert, TV().ingest([[1], 'x'], { format: 'jsonArrays' }), 'formatMismatch', 'non-array row');
        },
    });

    // ---------------- normalization pipeline (Addendum §B.8) ----------------

    U.push({
        suite, name: 'normalization: per-built-in vectors (trim, caseFold, nullCoerce, reformatNumber, promoteNumber, promoteBool)',
        fn: async ({ assertEq }) => {
            const one = async (fn, params, cells) => {
                const r = await TV().ingest([cells], {
                    format: 'jsonArrays',
                    normalization: { table: [{ fn, params }] },
                });
                return r.table.rows[0];
            };
            assertEq(await one('trim', null, ['  a  b ', 5, null, '\tx\n']), ['a b', 5, null, 'x'],
                'trim: ends stripped, internal runs collapsed, non-strings untouched');
            assertEq(await one('trim', { collapseInternal: false }, ['  a  b ']), ['a  b'],
                'trim: collapseInternal false keeps internal runs');
            assertEq(await one('caseFold', null, ['AbC', 7]), ['abc', 7], 'caseFold lower (default)');
            assertEq(await one('caseFold', { to: 'upper' }, ['AbC']), ['ABC'], 'caseFold upper');
            assertEq(await one('nullCoerce', { equivalents: ['NA', ''] }, ['NA', '', 'x', 0]), [null, null, 'x', 0],
                'nullCoerce: listed strings become native null');
            assertEq(await one('reformatNumber', { format: { decimalSeparator: ',', groupingSeparators: ['.'] } },
                ['1.234,50', 'x', '12', 3]), ['1234.50', 'x', '12', 3],
                'reformatNumber: canonical "."-decimal string, lexical precision preserved, otherwise unchanged');
            assertEq(await one('promoteNumber', null, ['12', '1.5', 'x', '1,5']), [12, 1.5, 'x', '1,5'],
                'promoteNumber: direct strict parse only without a format');
            assertEq(await one('promoteNumber', { format: { decimalSeparator: ',', groupingSeparators: [' '] } },
                ['1 234,5', '12']), [1234.5, 12], 'promoteNumber: given format accepted too');
            assertEq(await one('promoteBool', null, ['Yes', ' no ', '1', 'maybe', true]), [true, false, true, 'maybe', true],
                'promoteBool: default lists + strategy (trim, case-insensitive)');
        },
    });

    U.push({
        suite, name: 'normalization: messy-data built-ins (stripAffix, replaceChars, fillDown)',
        fn: async ({ assertEq }) => {
            const affix = await TV().ingest([[' $ 1,200 ', '12 %', '$', 'EUR5EUR', 7]], {
                format: 'jsonArrays',
                normalization: { table: [{ fn: 'stripAffix', params: { prefixes: ['$', 'EUR'], suffixes: ['%', 'EUR'] } }] },
            });
            assertEq(affix.table.rows[0], ['1,200', '12', '', '5', 7],
                'stripAffix: at most one prefix + one suffix, alsoTrim inside and out');
            const affix2 = await TV().ingest([['$$12']], {
                format: 'jsonArrays',
                normalization: { table: [{ fn: 'stripAffix', params: { prefixes: ['$', '$$'] } }] },
            });
            assertEq(affix2.table.rows[0], ['12'], 'stripAffix: longest prefix wins ($$ before $), stripped once');

            const rc = await TV().ingest([['a b — “q”']], {
                format: 'jsonArrays',
                normalization: { table: [{ fn: 'replaceChars', params: { map: { ' ': ' ', '—': '-', '“': '"', '”': '"' } } }] },
            });
            assertEq(rc.table.rows[0], ['a b - "q"'], 'replaceChars: NBSP/dash/curly-quote map, insertion order');

            // fillDown: top-to-bottom, leading empty stays, custom empties, ragged rows skipped
            const fd = await TV().ingest([[''], ['North'], [''], ['-'], ['South'], [''], []], {
                format: 'jsonArrays',
                normalization: { columns: { 0: [{ fn: 'fillDown', params: { treatAsEmpty: ['', '-'] } }] } },
            });
            assertEq(fd.table.rows, [[''], ['North'], ['North'], ['North'], ['South'], ['South'], []],
                'fillDown: nearest non-empty above; nothing above row 0; ragged row untouched');
            assertEq(fd.normalizationActions, [{ column: 0, fn: 'fillDown', count: 3 }], 'fillDown counts only changed cells');
        },
    });

    U.push({
        suite, name: 'normalization: ordering (table steps before column steps, step order within), headers untouched',
        fn: async ({ assertEq }) => {
            const r = await TV().ingest(' Amount \n" NA "\n" 1 234,50 "', {
                format: 'csv',
                normalization: {
                    table: [{ fn: 'trim' }],
                    columns: {
                        // keys match the INGESTED header verbatim — headers are never normalized
                        ' Amount ': [
                            { fn: 'nullCoerce', params: { equivalents: ['NA'] } },      // sees trimmed "NA"
                            { fn: 'reformatNumber', params: { format: { decimalSeparator: ',', groupingSeparators: [' '] } } },
                        ],
                    },
                },
            });
            assertEq(r.table.headers, [' Amount '], 'header cells are never normalized');
            assertEq(r.table.rows, [[null], ['1234.50']],
                'table trim ran first (so nullCoerce matched "NA" and reformat saw "1 234,50")');
            assertEq(r.normalizationActions, [
                { column: ' Amount ', fn: 'trim', count: 2 },
                { column: ' Amount ', fn: 'nullCoerce', count: 1 },
                { column: ' Amount ', fn: 'reformatNumber', count: 1 },
            ], 'actions: first-touch order, counts = cells actually changed; column = header name');
            // no normalization → no normalizationActions field at all
            const plain = await TV().ingest('a\n1', { format: 'csv' });
            assertEq(plain.normalizationActions, undefined, 'absent unless a pipeline ran');
        },
    });

    U.push({
        suite, name: 'normalization: host-registered functions, contract faults',
        fn: async ({ assert, assertEq }) => {
            const r = await TV().ingest([['x', 1]], {
                format: 'jsonArrays',
                normalization: { table: [{ fn: 'tag', params: { mark: '!' } }] },
            }, {
                normalizationFunctions: {
                    tag: (cell, coords, params) => typeof cell === 'string' ? cell + params.mark + coords.row : cell,
                },
            });
            assertEq(r.table.rows[0], ['x!0', 1], 'host function receives (cell, coordinates, params)');
            const boom = await expectCode(assert, TV().ingest([['x']], {
                format: 'jsonArrays', normalization: { table: [{ fn: 'boom' }] },
            }, { normalizationFunctions: { boom: () => { throw new Error('nope'); } } }),
                'normalizationFunctionError', 'throwing function');
            assertEq(boom.detail.fn, 'boom', 'detail names the function');
            await expectCode(assert, TV().ingest([['x']], {
                format: 'jsonArrays', normalization: { table: [{ fn: 'obj' }] },
            }, { normalizationFunctions: { obj: () => ({ not: 'scalar' }) } }),
                'normalizationFunctionContractViolation', 'non-scalar return');
        },
    });

    U.push({
        suite, name: 'normalization: spec rules I8–I10 (unknown fn, table-level fillDown, bad params, headerless keys)',
        fn: async ({ assert, assertEq }) => {
            const err = await expectCode(assert, TV().ingest('a\n1', {
                format: 'csv',
                normalization: {
                    table: [{ fn: 'nope' }, { fn: 'fillDown' }, { fn: 'nullCoerce' }],
                    columns: { a: [{ fn: 'stripAffix', params: {} }] },
                    extra: true,
                },
            }), 'ingestSpecInvalid', 'invalid NormalizationSpec');
            const paths = err.detail.map((d) => d.path);
            assert(paths.includes('normalization.extra'), 'unknown NormalizationSpec key');
            assert(paths.includes('normalization.table[0].fn'), 'unknown fn (I9)');
            assert(paths.includes('normalization.table[1].fn'), 'fillDown is per-column only');
            assert(paths.includes('normalization.table[2].params.equivalents'), 'nullCoerce params required');
            assert(paths.includes('normalization.columns."a"[0].params'), 'stripAffix needs at least one affix');
            // I10: headerless sources key columns by 0-based position
            const pos = await expectCode(assert, TV().ingest('1\n2', {
                format: 'csv', header: { mode: 'none' },
                normalization: { columns: { first: [{ fn: 'trim' }] } },
            }), 'ingestSpecInvalid', 'non-positional key on headerless source');
            assertEq(pos.detail[0].path, 'normalization.columns."first"', 'I10 path');
            // unmatched header-name key: inert with an advisory, not fatal
            const inert = await TV().ingest('a\nx', {
                format: 'csv', normalization: { columns: { zz: [{ fn: 'trim' }] } },
            });
            assertEq(inert.warnings.map((w) => w.code), ['irrelevantIngestSetting'], 'unmatched column key advisory');
        },
    });

    U.push({
        suite, name: 'normalization: reformatTemporal + the raw-vs-normalized validation story end to end',
        needsLuxon: true,
        fn: async ({ assert, assertEq }) => {
            const csv = 'id,amount,day\n 1 ,"1 234,50",15.07.2026\n2,NA,2026-07-16\n';
            const spec = (norm) => ({ format: 'csv', normalization: norm });
            const schema = {
                meta: { schemaVersion: '1.0.0', name: 'consumption' },
                nullHandling: { nullEquivalents: [''] },
                evaluation: { strictType: false, timezone: 'utc' },
                columns: {
                    id: { type: { name: 'int' } },
                    amount: { nullable: true, type: { name: 'float' } },       // plain "."-decimal only
                    day: { type: { name: 'date', formats: ['yyyy-MM-dd'] } },  // ISO only
                },
            };
            // raw feed: fails the consumption contract (regional number, dotted date, " 1 ")
            const raw = await TV().ingest(csv, spec(null));
            assert(!TV().validate(schema, raw.table).valid, 'raw feed fails the consumption contract');
            // normalized output: passes the same schema
            const norm = await TV().ingest(csv, spec({
                table: [{ fn: 'trim' }],
                columns: {
                    amount: [
                        { fn: 'nullCoerce', params: { equivalents: ['NA'] } },
                        { fn: 'reformatNumber', params: { format: { decimalSeparator: ',', groupingSeparators: [' '] } } },
                    ],
                    day: [{ fn: 'reformatTemporal', params: { from: ['dd.MM.yyyy'], to: 'yyyy-MM-dd' } }],
                },
            }));
            assertEq(norm.table.rows, [['1', '1234.50', '2026-07-15'], ['2', null, '2026-07-16']], 'normalized cells');
            const res = TV().validate(schema, norm.table);
            assert(res.valid, 'normalized output passes the same schema');
            assertEq(norm.normalizationActions, [
                { column: 'id', fn: 'trim', count: 1 },
                { column: 'amount', fn: 'nullCoerce', count: 1 },
                { column: 'amount', fn: 'reformatNumber', count: 1 },
                { column: 'day', fn: 'reformatTemporal', count: 1 },
            ], 'provenance counts per (column, fn); zero-change (column, fn) pairs are omitted');
        },
    });

    U.push({
        suite, name: 'normalization (§6.10, 1.6.0) — reformatNumber preserves decimal exactness end to end; promoteNumber destroys it and sumEquals discloses binary64FallbackRows (the §B.8 honesty note)',
        fn: async ({ assert, assertEq }) => {
            // reformatNumber: exactness preserved through the working copy, and a decimal
            // column validates the normalized cell at an EXACT inclusive boundary.
            const r1 = await TV().ingest([['amount'], ['1.234,50']], { format: 'jsonArrays', header: { mode: 'firstRow' },
                normalization: { columns: { amount: [{ fn: 'reformatNumber',
                    params: { format: { decimalSeparator: ',', groupingSeparators: ['.'] } } }] } } });
            assertEq(r1.table.rows, [['1234.50']], 'reformatNumber emits the §3.5 working copy, lexical precision preserved');
            const schemaDec = { meta: { schemaVersion: '1.0.0', name: 'dec' }, resultConfig: { collectCellRegister: true },
                evaluation: { strictType: false, timezone: 'utc' },
                columns: { amount: { type: { name: 'decimal', value: { min: 1234.50, max: 1234.50, minInclusive: true, maxInclusive: true } } } } };
            assert(TV().validate(schemaDec, r1.table).valid, 'validation AFTER normalization is exact: the boundary pass proves no precision was lost');

            // promoteNumber: the one built-in that destroys decimal-text exactness — every
            // promoted cell becomes a native number, so a downstream sumEquals on that
            // decimal column discloses EVERY row via binary64FallbackRows.
            const r2 = await TV().ingest([['amount'], ['0.10'], ['0.20']], { format: 'jsonArrays', header: { mode: 'firstRow' },
                normalization: { columns: { amount: [{ fn: 'promoteNumber', params: null }] } } });
            assertEq(r2.table.rows, [[0.1], [0.2]], 'promoteNumber emits native numbers');
            const schemaSum = { meta: { schemaVersion: '1.0.0', name: 'dec' }, resultConfig: { collectCellRegister: true },
                evaluation: { strictType: false, timezone: 'utc' },
                columns: { amount: { type: { name: 'decimal' } } },
                customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['amount'], expectedValue: 1.00, expectedFieldRow: 'first', tolerance: 0 }] };
            const v2 = TV().validate(schemaSum, r2.table);
            assert(!v2.valid, 'sum 0.3 ≠ expected 1.00 — a deliberately mismatched expected value so the disclosure context is populated');
            assertEq(v2.summary.details[0].context.binary64FallbackRows, [0, 1],
                'both promoted (now-native) rows are disclosed as binary64 fallback contributors — the honesty note, end to end from ingest through sumEquals');
        },
    });

    U.push({
        suite, name: 'ingest → validate decoupling: ingest never judges, the engine does',
        fn: async ({ assert, assertEq }) => {
            const r = await TV().ingest('id,amount\n1,not-a-number\n1,2', { format: 'csv' });
            assertEq(r.warnings, [], 'garbage data produces no ingest warnings — data quality is validate()\'s job');
            const schema = {
                meta: { schemaVersion: '1.0.0', name: 't' },
                evaluation: { strictType: false, timezone: 'utc' },
                columns: {
                    id: { type: { name: 'int' }, unique: { enabled: true } },
                    amount: { type: { name: 'float' } },
                },
            };
            const res = TV().validate(schema, r.table);
            assert(!res.valid, 'the engine, not ingest, finds the problems');
            assertEq(res.summary.bySeverity.error, 3, 'typeMismatch + 2 uniquenessViolation entries as violations');
        },
    });

    U.push({
        suite, name: 'exportComparisonXlsx: spec argument names, expected rows on Data sheet, messageTemplates (JS spec §3.6/§3.7)',
        needsExcelJS: true,
        fn: async ({ assert, assertEq }) => {
            const schema = {
                meta: { schemaVersion: '1.0.0', name: 'cmp-export' },
                resultConfig: { collectCellRegister: true },
                evaluation: { strictType: false, timezone: 'utc' },
                columns: { id: { type: { name: 'int' } }, v: { type: { name: 'int' } } },
                comparison: { match: { keys: ['id'] } },
            };
            const produced = { headers: ['id', 'v'], rows: [['1', '2']] };
            const expected = { headers: ['id', 'v'], rows: [['1', '3']] };
            const result = TV().compare(schema, produced, expected);
            assert(!result.valid, 'value mismatch expected');
            const blob = await TV().exportComparisonXlsx({
                result, table: produced, schema, expected,                            // §3.7 argument names
                messageTemplates: { valueMismatch: (c) => `LOCALIZED ${c.produced} vs ${c.expected}` },  // §3.6 threading
            });
            const wb = new window.ExcelJS.Workbook();
            await wb.xlsx.load(await blob.arrayBuffer());
            const data = wb.getWorksheet('Data');
            const texts = [];
            data.eachRow((row) => texts.push(row.values.slice(1).map((v) => (v == null ? '' : String(v))).join('|')));
            assert(texts.some((t) => t.includes('— expected —')), 'Data sheet carries the expected section');
            assert(texts.some((t) => t.includes('3')), 'expected rows present');
            const errs = wb.getWorksheet('Errors');
            let found = false;
            errs.eachRow((row) => { if (String(row.getCell(6).value).startsWith('LOCALIZED')) found = true; });
            assert(found, 'Errors sheet message rendered through the messageTemplates override');
            assertEq(errs.getRow(1).getCell(6).value, 'Message', 'Errors sheet layout unchanged');
        },
    });

    U.push({
        suite, name: 'xlsx: §B.3 cell mapping (dates, formulas, rich text, merged, errors), sheets',
        needsExcelJS: true,
        fn: async ({ assert, assertEq }) => {
            const wb = new window.ExcelJS.Workbook();
            const ws = wb.addWorksheet('Data');
            ws.addRow(['n', 'd', 'dt', 'f', 'fx', 'rt', 'b', 'err']);
            const row = ws.addRow([]);
            row.getCell(1).value = 12.5;
            row.getCell(2).value = new Date(Date.UTC(2026, 6, 15));                    // midnight → date-only
            row.getCell(3).value = new Date(Date.UTC(2026, 6, 15, 14, 30, 45, 123));  // with time+ms
            row.getCell(4).value = { formula: 'A2*2', result: 25 };
            row.getCell(5).value = { formula: 'A2*3' };                                // no cached result
            row.getCell(6).value = { richText: [{ text: 'he' }, { text: 'llo' }] };
            row.getCell(7).value = true;
            row.getCell(8).value = { error: '#DIV/0!' };
            ws.addRow(['m', null, null, null, null, null, null, null]);
            ws.mergeCells('A3:B3');
            wb.addWorksheet('Other').addRow(['x']);
            const buffer = await wb.xlsx.writeBuffer();

            const r = await TV().ingest(buffer, { format: 'xlsx', xlsx: { sheet: 'Data' } });
            assertEq(r.source.sheetName, 'Data', 'resolved sheet name in provenance');
            assertEq(r.table.headers, ['n', 'd', 'dt', 'f', 'fx', 'rt', 'b', 'err'], 'first row → headers');
            const d = r.table.rows[0];
            assertEq(d[0], 12.5, 'number stays native');
            assertEq(d[1], '2026-07-15', 'midnight date → yyyy-MM-dd (zone-less, format-independent)');
            assertEq(d[2], '2026-07-15T14:30:45.123', 'datetime → ISO with .SSS when ms ≠ 0');
            assertEq(d[3], 25, 'formula → cached result');
            assertEq(d[4], null, 'formula without cached result → null');
            assertEq(d[5], 'hello', 'rich text → concatenated plain text');
            assertEq(d[6], true, 'boolean stays native');
            assertEq(d[7], '#DIV/0!', 'error value → its code as a string');
            assertEq(r.table.rows[1][0], 'm', 'merged master keeps its value');
            assertEq(r.table.rows[1][1], null, 'merged non-master → null');
            const codes = r.warnings.map((w) => w.code).sort();
            assertEq(codes, ['errorCell', 'formulaNoCachedResult', 'mergedCell'], 'lossy-mapping warnings');
            // sheet by index + sheetNotFound
            const byIdx = await TV().ingest(buffer, { format: 'xlsx', xlsx: { sheet: 1 } });
            assertEq(byIdx.source.sheetName, 'Other', '0-based index selection');
            await expectCode(assert, TV().ingest(buffer, { format: 'xlsx', xlsx: { sheet: 'Nope' } }),
                'sheetNotFound', 'missing sheet');
            const e = await expectCode(assert, TV().ingest(new Uint8Array([1, 2, 3]), { format: 'xlsx' }),
                'formatMismatch', 'non-zip bytes');
            assert(e !== null, 'formatMismatch surfaced');
        },
    });

    U.push({
        suite, name: 'normalization reformatNumber (1.2.0): allowBareDecimal canonicalizes ".85" to "0.85"',
        fn: async ({ assert, assertEq }) => {
            const r = await TV().ingest('v\n.85\n-.02\n6.16\nabc\n', {
                format: 'csv',
                normalization: { columns: { v: [{ fn: 'reformatNumber',
                    params: { format: { decimalSeparator: '.', groupingSeparators: [','], allowBareDecimal: true } } }] } },
            });
            assertEq(r.table.rows.map((row) => row[0]), ['0.85', '-0.02', '6.16', 'abc'],
                'bare decimals gain the leading zero; unparseable content passes through');
            const acts = r.normalizationActions;
            assertEq(acts, [{ column: 'v', fn: 'reformatNumber', count: 2 }], 'only the two changed cells counted');
        },
    });

    U.push({
        suite, name: 'encoding (Addendum §B.5): UTF-16BE BOM (FE FF); already-decoded string source strips a leading BOM char',
        fn: async ({ assertEq }) => {
            // FE FF → utf-16be
            const s = 'a\n1';
            const u16 = new Uint8Array(2 + s.length * 2);
            u16[0] = 0xFE; u16[1] = 0xFF;
            for (let i = 0; i < s.length; i++) { u16[2 + i * 2] = 0; u16[3 + i * 2] = s.charCodeAt(i); }
            const r = await TV().ingest(u16, { format: 'csv' });
            assertEq(r.source.encodingUsed, 'utf-16be', 'FE FF → utf-16be');
            assertEq(r.table.rows, [['1']], 'utf-16be decoded');
            // already-decoded JS string (no bytes involved) beginning with U+FEFF: the leading
            // BOM character is stripped even though no decoding step ran (encodingUsed stays null)
            const withBomStr = '﻿a\n1';
            const r2 = await TV().ingest(withBomStr, { format: 'csv' });
            assertEq(r2.table.headers, ['a'], 'leading BOM character stripped from a string source');
            assertEq(r2.source.encodingUsed, null, 'no byte-decoding step ran, so encodingUsed is still null');
        },
    });

    U.push({
        suite, name: 'xlsx (Addendum §B.3): trailing all-null rows/columns dropped, interior rows/columns preserved',
        needsExcelJS: true,
        fn: async ({ assertEq }) => {
            const wb = new window.ExcelJS.Workbook();
            const ws = wb.addWorksheet('Data');
            ws.addRow(['a', 'b', null]);        // header row: column c is null here too (all-null trailing column)
            ws.addRow([1, 2, null]);
            ws.addRow([null, null, null]);      // interior all-null row — must be PRESERVED
            ws.addRow([4, 5, null]);
            ws.addRow([null, null, null]);      // trailing all-null row — must be DROPPED
            const buffer = await wb.xlsx.writeBuffer();
            const r = await TV().ingest(buffer, { format: 'xlsx' });
            assertEq(r.table.headers, ['a', 'b'], 'trailing all-null column (c) dropped');
            assertEq(r.table.rows, [[1, 2], [null, null], [4, 5]],
                'trailing all-null row dropped; interior all-null row kept as [null, null]');
            assertEq(r.source.columnCount, 2, 'provenance reflects the post-drop width');
        },
    });

    U.push({
        suite, name: 'xlsx (Addendum §B.7): IngestWarning collapses repeated same-code/same-column warnings via count',
        needsExcelJS: true,
        fn: async ({ assertEq }) => {
            const wb = new window.ExcelJS.Workbook();
            const ws = wb.addWorksheet('Data');
            ws.addRow(['a']);
            ws.addRow(['x']);
            ws.addRow(['y']);
            ws.addRow(['z']);
            ws.addRow(['w']);
            ws.mergeCells('A2:A3');  // merge #1 in column 0
            ws.mergeCells('A4:A5');  // merge #2 in column 0 — same code+column as #1
            const buffer = await wb.xlsx.writeBuffer();
            const r = await TV().ingest(buffer, { format: 'xlsx' });
            assertEq(r.warnings, [{
                code: 'mergedCell', message: 'Merged range: non-master cells emitted as null',
                row: 1, column: 0, count: 2,
            }], 'two same-code/same-column merges collapse into one warning; count=2, row=first occurrence');
        },
    });

    U.push({
        suite, name: 'normalization (Addendum §B.8): reformatNumber negativeStyle canonicalization (parentheses, trailingMinus)',
        fn: async ({ assertEq }) => {
            const one = async (params, cells) => {
                const r = await TV().ingest([cells], { format: 'jsonArrays', normalization: { table: [{ fn: 'reformatNumber', params }] } });
                return r.table.rows[0];
            };
            assertEq(
                await one({ format: { decimalSeparator: ',', groupingSeparators: ['.'], negativeStyle: 'parentheses' } },
                    ['(1.234,50)', '1.234,50', 'x']),
                ['-1234.50', '1234.50', 'x'],
                'parentheses: "(1.234,50)" -> "-1234.50"; unwrapped form stays positive; unparseable passes through');
            assertEq(
                await one({ format: { decimalSeparator: '.', groupingSeparators: [','], negativeStyle: 'trailingMinus' } },
                    ['1,234.50-', '5.00', 'x']),
                ['-1234.50', '5.00', 'x'],
                'trailingMinus: trailing "-" canonicalizes to a leading "-"');
        },
    });

    U.push({
        suite, name: 'normalization (Addendum §B.8, 1.3.0): reformatTemporal twoDigitYearPivot',
        needsLuxon: true,
        fn: async ({ assert, assertEq }) => {
            const reform = (params, cell) => TV().ingest([[cell]], {
                format: 'jsonArrays',
                normalization: { table: [{ fn: 'reformatTemporal', params: Object.assign({ from: ['dd.MM.yy'], to: 'yyyy-MM-dd' }, params) }] },
            }).then((r) => r.table.rows[0][0]);
            assertEq(await reform({}, '15.07.61'), '1961-07-15', 'default pivot 1961: yy=61 -> 1961 (pivot itself)');
            assertEq(await reform({ twoDigitYearPivot: 1900 }, '15.07.61'), '1961-07-15',
                'custom pivot 1900: yy=61 still maps to 1961 (within [1900, 1999])');
            assertEq(await reform({ twoDigitYearPivot: 1900 }, '15.07.19'), '1919-07-15',
                'custom pivot 1900: yy=19 maps to 1919, not 2019');
            const err = await expectCode(assert, TV().ingest([['15.07.61']], {
                format: 'jsonArrays',
                normalization: { table: [{ fn: 'reformatTemporal', params: { from: ['dd.MM.yy'], to: 'yyyy-MM-dd', twoDigitYearPivot: 42 } }] },
            }), 'ingestSpecInvalid', 'out-of-range pivot');
            assertEq(err.detail, [{ path: 'normalization.table[0].params.twoDigitYearPivot', expected: 'integer in [1000, 9899]', actual: 42 }],
                'shape-validated to [1000, 9899]');
        },
    });

    U.push({
        suite, name: 'normalization (Addendum §B.8, 1.3.0, B059): reformatTemporal `to`-format SSSSSS microsecond rendering',
        needsLuxon: true,
        fn: async ({ assertEq }) => {
            // Luxon has no native 6-digit sub-second render token; a `to` format containing
            // SSSSSS renders the (truncated) 3-digit millisecond value plus a literal "000" —
            // a documented six-digit-resolution workaround, not genuine microsecond precision.
            const reform = (cell) => TV().ingest([[cell]], {
                format: 'jsonArrays',
                normalization: {
                    table: [{ fn: 'reformatTemporal', params: { from: ['yyyy-MM-dd HH:mm:ss.SSS'], to: 'yyyy-MM-dd HH:mm:ss.SSSSSS' } }],
                },
            }).then((r) => r.table.rows[0][0]);
            assertEq(await reform('2026-07-13 12:00:00.123'), '2026-07-13 12:00:00.123000',
                'millisecond value 123 renders as 123 followed by a literal 000');
            assertEq(await reform('2026-07-13 12:00:00.007'), '2026-07-13 12:00:00.007000',
                'sub-100ms value stays zero-padded to 3 digits before the literal 000');
        },
    });

    U.push({
        suite, name: 'normalization (Addendum §B.8): stripAffix no-match-but-trimmed passthrough; promoteBool overlap I9 error',
        fn: async ({ assert, assertEq }) => {
            const noMatch = await TV().ingest([['  hello  ']], {
                format: 'jsonArrays',
                normalization: { table: [{ fn: 'stripAffix', params: { prefixes: ['$'], suffixes: ['%'] } }] },
            });
            assertEq(noMatch.table.rows[0], ['hello'],
                'no prefix/suffix matched, but the trimmed form is still returned (alsoTrim default true)');
            const err = await expectCode(assert, TV().ingest([['x']], {
                format: 'jsonArrays',
                normalization: { table: [{ fn: 'promoteBool', params: { trueValues: ['Y'], falseValues: ['y'] } }] },
            }), 'ingestSpecInvalid', 'trueValues/falseValues overlap after matchStrategy');
            assertEq(err.detail, [{
                path: 'normalization.table[0].params.trueValues',
                expected: 'no overlap with falseValues after matchStrategy', actual: 'y',
            }], 'I9: overlap detected after default case-insensitive strategy ("Y" and "y" collide)');
        },
    });

    U.push({
        suite, name: 'normalization (Addendum §B.8, B057): stripAffix alsoTrim:false — no trim before matching, none after',
        fn: async ({ assertEq }) => {
            const one = async (cell, params) => {
                const r = await TV().ingest([[cell]], { format: 'jsonArrays', normalization: { table: [{ fn: 'stripAffix', params }] } });
                return r.table.rows[0][0];
            };
            assertEq(await one('  $12  ', { prefixes: ['$'], alsoTrim: false }), '  $12  ',
                'alsoTrim:false: leading whitespace before the affix blocks the match, and the untouched cell passes through untrimmed');
            assertEq(await one('$12  ', { prefixes: ['$'], alsoTrim: false }), '12  ',
                'alsoTrim:false: a direct affix match still strips, but trailing whitespace after stripping is kept, not trimmed');
            assertEq(await one('  $12  ', { prefixes: ['$'], alsoTrim: true }), '12',
                'control: alsoTrim:true (default) trims before matching and after stripping');
        },
    });

    U.push({
        suite, name: 'normalization (1.3.1): non-scalar cells pass through built-ins as no-ops',
        fn: async ({ assert, assertEq }) => {
            // pre-1.3.1 the trim pass threw normalizationFunctionContractViolation on the object cell
            const r = await TV().ingest([[{ nested: 1 }, ' x ']], {
                format: 'jsonArrays', normalization: { table: [{ fn: 'trim' }] },
            });
            assertEq(r.table.rows[0][0], { nested: 1 }, 'object cell arrives unchanged in the output table');
            assertEq(r.table.rows[0][1], 'x', 'sibling strings still trimmed');
            assertEq(r.normalizationActions, [{ column: 1, fn: 'trim', count: 1 }],
                'only genuinely changed cells counted — the untouched object cell contributes 0');
            // a host fn RETURNING a new non-scalar remains a contract violation
            await expectCode(assert, TV().ingest([[{ nested: 1 }]], {
                format: 'jsonArrays', normalization: { table: [{ fn: 'swap' }] },
            }, { normalizationFunctions: { swap: () => ({ other: 2 }) } }),
                'normalizationFunctionContractViolation', 'CHANGED non-scalars still violate the contract');
        },
    });

})();
