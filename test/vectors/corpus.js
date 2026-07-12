/* Quality program — real-world file corpus for ingest() (WS6 item 1).
 *
 * The XLSX fixtures below are BYTE-ACCURATE reconstructions of the structures the
 * three big producers actually write — generated, then base64-embedded so the suite
 * stays file://-loadable (a file:// page cannot fetch() sibling binaries):
 *   XLSX_EXCEL  — desktop-Excel shape: sharedStrings, a SHARED FORMULA group with
 *                 cached results (master <f t="shared" ref>…</f><v> + si-only members),
 *                 date-styled serials (numFmtId 14, 1900 system), and a STYLED-EMPTY
 *                 region over-reporting the used range (trailing rows/col must drop).
 *   XLSX_1904   — <workbookPr date1904="1"/> (classic Mac-Excel): serial 100 must map
 *                 to 1904-04-10, not the 1900-system reading.
 *   XLSX_INLINE — Google-Sheets/LibreOffice shape: t="inlineStr" cells (no
 *                 sharedStrings part at all), unicode + xml:space="preserve".
 * The CSV fixtures are literal bytes of the two classic Excel exports (UTF-8-BOM
 * semicolon; ANSI/windows-1252 semicolon) and a fully-quoted DB dump.
 *
 * See test/fixtures/README.md for the cases where a GENUINE producer file would still
 * add value over these reconstructions.
 */
'use strict';
(function () {
    const U = window.__UNIT__;
    const suite = 'corpus';
    const TV = () => window.TableValidation;

    const b64 = (s) => {
        const bin = atob(s);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    };

    const XLSX_EXCEL = b64('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' +
        'AE8IAAAAAA==');
    const XLSX_1904 = b64('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');
    const XLSX_INLINE = b64('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');
    const CSV_EXCEL_UTF8 = b64('77u/aWQ7YmV0cmFnO3N0YWR0DQoxOzEuMjM0LDUwO0vDtmxuDQoyOzk5LDEwO03DvG5jaGVuDQo=');
    const CSV_EXCEL_ANSI = b64('aWQ7bmFtZQ0KMTtSZW7pDQoyO0r8cmdlbg0K');
    const CSV_DB_DUMP = b64('ImlkIiwibm90ZSIKIjEiLCJzYWlkICIiaGkiIiIKIjIiLCJsaW5lCmJyZWFrLCBhbmQsIGNvbW1hcyIKIjMiLCIiCg==');

    U.push({
        suite, name: 'XLSX (Excel shape): sharedStrings, shared formulas w/ cached results, date serials, styled-empty region',
        needsExcelJS: true,
        fn: async ({ assert, assertEq }) => {
            const r = await TV().ingest(XLSX_EXCEL, { format: 'xlsx' });
            assertEq(r.table.headers, ['id', 'qty', 'double', 'day'], 'sharedStrings headers');
            assertEq(r.table.rows.length, 3, 'styled-empty trailing rows dropped (used-range over-report)');
            assertEq(r.table.rows[0].length, 4, 'styled-empty trailing column dropped');
            assertEq(r.table.rows.map((x) => x[2]), [10, 14, 18],
                'shared-formula members (master AND si-only refs) emit their cached results');
            assertEq(r.table.rows.map((x) => x[3]), ['2025-08-01', '2025-08-02', '2025-08-02T12:00:00'],
                'date-styled serials render as zone-less ISO (date-only at midnight)');
            assertEq(r.warnings, [], 'cached formulas are silent — no formulaNoCachedResult');
            // the emitted table validates like any other feed
            const res = TV().validate({
                meta: { schemaVersion: '1.0.0', name: 'corpus' },
                evaluation: { strictType: false, timezone: 'utc' },
                columns: {
                    id: { type: { name: 'int' } }, qty: { type: { name: 'int' } },
                    double: { type: { name: 'int' } },
                    // the column mixes date-only and datetime renderings (midnight rule) —
                    // an ISO-shape regex keeps the corpus check type-agnostic
                    day: { type: { name: 'string', regex: '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2})?$' } },
                },
            }, r.table);
            assert(res.valid, 'corpus table validates: ' + JSON.stringify(res.summary.details.map((d) => d.ruleName)));
        },
    });

    U.push({
        suite, name: 'XLSX: 1904 date system respected',
        needsExcelJS: true,
        fn: async ({ assertEq }) => {
            const r = await TV().ingest(XLSX_1904, { format: 'xlsx' });
            assertEq(r.table.headers, ['day'], 'inline header');
            assertEq(r.table.rows, [['1904-04-10']], 'serial 100 under date1904 → 1904-04-10 (1900 system would say 1900-04-09)');
        },
    });

    U.push({
        suite, name: 'XLSX (Sheets/LibreOffice shape): inline strings, no sharedStrings part',
        needsExcelJS: true,
        fn: async ({ assertEq }) => {
            const r = await TV().ingest(XLSX_INLINE, { format: 'xlsx' });
            assertEq(r.table.headers, ['name', 'n'], 'inlineStr headers');
            assertEq(r.table.rows, [['Zoé — “quoted”', 1], [' spaced ', 2]],
                'unicode + xml:space-preserved whitespace survive');
        },
    });

    U.push({
        suite, name: 'CSV corpus: Excel UTF-8-BOM semicolon export; ANSI (windows-1252) export; quoted DB dump',
        fn: async ({ assertEq }) => {
            const utf8 = await TV().ingest(CSV_EXCEL_UTF8, { format: 'csv', csv: { delimiter: ';' } });
            assertEq(utf8.source.encodingUsed, 'utf-8', 'BOM → utf-8, BOM stripped');
            assertEq(utf8.table.headers, ['id', 'betrag', 'stadt'], 'first header carries no BOM remnant');
            assertEq(utf8.table.rows, [['1', '1.234,50', 'Köln'], ['2', '99,10', 'München']], 'regional decimals + umlauts');

            const ansi = await TV().ingest(CSV_EXCEL_ANSI, { format: 'csv', csv: { delimiter: ';' } });
            assertEq(ansi.source.encodingUsed, 'windows-1252', 'invalid UTF-8 → the single defined fallback');
            assertEq(ansi.warnings.map((w) => w.code), ['encodingFallback'], 'fallback surfaced as a warning');
            assertEq(ansi.table.rows, [['1', 'René'], ['2', 'Jürgen']], '0xE9/0xFC decoded as windows-1252');

            const dump = await TV().ingest(CSV_DB_DUMP, { format: 'csv' });
            assertEq(dump.table.rows, [['1', 'said "hi"'], ['2', 'line\nbreak, and, commas'], ['3', '']],
                'doubled quotes, embedded newline/commas, quoted empty field');
        },
    });
})();
