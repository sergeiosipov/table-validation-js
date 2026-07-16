/* Unit tests — public API surface: config errors, adapters, buildReport, exportXlsx, constants. */
'use strict';
(function () {
    const U = (name, fn, extra) => window.__UNIT__.push(Object.assign({ suite: 'api / units', name, fn }, extra));
    const TV = () => window.TableValidation;
    const META = { schemaVersion: '1.0.0', name: 't' };
    const SIMPLE = () => ({ meta: META, columns: { a: { type: { name: 'string' } } } });

    U('constants — VERSION, SPEC_VERSION, result.specVersion', (t) => {
        // pinned RELATIONALLY (VERSION === SPEC_VERSION === result.specVersion);
        // release-check owns the one literal claim, in README
        t.assertEq(TV().VERSION, TV().SPEC_VERSION, 'VERSION === SPEC_VERSION');
        t.assert(/^\d+\.\d+\.\d+$/.test(TV().VERSION), 'VERSION is semver');
        const r = TV().validate(SIMPLE(), { headers: ['a'], rows: [] });
        t.assertEq(r.specVersion, TV().SPEC_VERSION, 'result.specVersion');
    });
    U('drafts and builder seed stamp the CURRENT spec version (1.5.1)', (t) => {
        // v1.3.1 shipped drafts stamping a stale '1.3.0' — pin both stamps to the
        // constant so a missed bump can never ship silently again. The ONE literal
        // release pin of the suite lives here (release-check enforces its presence):
        t.assertEq(TV().SPEC_VERSION, '1.5.1', 'release literal');
        const seed = TV().createConfigBuilder().build();
        t.assertEq(seed.meta.schemaVersion, TV().SPEC_VERSION, 'builder default seed schemaVersion');
        const inf = TV().inferConfig({ headers: ['a'], rows: [['1'], ['2'], ['3']] });
        t.assertEq(inf.draft.meta.schemaVersion, TV().SPEC_VERSION, 'inferred draft schemaVersion');
    });

    U('config errors — thrown only for caller mistakes, never for schema content', (t) => {
        const E = 'TableValidationConfigError';
        t.assertThrows(() => TV().validate('x', { rows: [] }), E, 'non-object schema');
        t.assertThrows(() => TV().validate(SIMPLE(), 'x'), E, 'non-object table');
        t.assertThrows(() => TV().validate(SIMPLE(), { headers: ['a'], rows: 'x' }), E, 'rows not array');
        t.assertThrows(() => TV().validate(SIMPLE(), { headers: ['a'], rows: [['a'], 'x'] }), E, 'row not array');
        t.assertThrows(() => TV().validate(SIMPLE(), { headers: [1], rows: [] }), E, 'non-string header');
        t.assertThrows(() => TV().validate(SIMPLE(), { headers: ['a'], rows: [] }, { functions: 'x' }), E, 'functions not object');
        t.assertThrows(() => TV().validate(SIMPLE(), { headers: ['a'], rows: [] }, { referenceInstant: 42 }), E, 'referenceInstant wrong type');
        // schema CONTENT errors are violations, not throws:
        const r = TV().validate({ columns: {} }, { headers: [], rows: [] });
        t.assertEq(r.valid, false, 'schema content error yields invalid result');
        t.assertEq(r.aborted, true, 'schema content error aborts');
        t.assertEq(r.abortReason, 'schemaInvalid', 'abortReason schemaInvalid');
        t.assertEq(r.summary.bySeverity.error, 1, 'recorded as one error');
    });

    U('config errors — unusable referenceInstant with a temporal schema', (t) => {
        const schema = {
            meta: META,
            columns: { d: { type: { name: 'date', formats: ['yyyy-MM-dd'] } } },
        };
        t.assertThrows(
            () => TV().validate(schema, { headers: ['d'], rows: [] }, { referenceInstant: 'garbage' }),
            'TableValidationConfigError', 'garbage referenceInstant');
    }, { needsLuxon: true });

    U('adapters.fromArrays — header mode, positional mode, freshness', (t) => {
        const data = [[1, 'a'], [2, 'b']];
        const withHeader = TV().adapters.fromArrays(data, { hasHeaderRow: true });
        t.assertEq(withHeader.headers, ['1', 'a'], 'headers String()-converted');
        t.assertEq(withHeader.rows, [[2, 'b']], 'remaining rows');
        const positional = TV().adapters.fromArrays(data);
        t.assertEq(positional.headers, null, 'headerless mode');
        t.assertEq(positional.rows, [[1, 'a'], [2, 'b']], 'all rows kept');
        positional.rows[0][0] = 999;
        t.assertEq(data[0][0], 1, 'input not shared with output');
        t.assertThrows(() => TV().adapters.fromArrays('x'), 'TableValidationConfigError', 'non-array input');
        t.assertThrows(() => TV().adapters.fromArrays([1]), 'TableValidationConfigError', 'non-array row');
    });

    U('adapters.fromObjects — first-seen key union, missing keys become null', (t) => {
        const out = TV().adapters.fromObjects([{ a: 1 }, { b: 2, a: 3 }]);
        t.assertEq(out.headers, ['a', 'b'], 'first-seen key order');
        t.assertEq(out.rows, [[1, null], [3, 2]], 'missing keys null-filled');
        t.assertThrows(() => TV().adapters.fromObjects([1]), 'TableValidationConfigError', 'non-object record');
    });

    U('buildReport — all four verdicts and aggregates', (t) => {
        const mk = (schema, table, options) => TV().buildReport(TV().validate(schema, table, options));

        const pass = mk(SIMPLE(), { headers: ['a'], rows: [['x']] });
        t.assertEq(pass.verdict, 'pass', 'pass verdict');
        t.assertEq(pass.needsAttention, false, 'pass needs no attention');

        const warn = mk({
            meta: META,
            columns: { a: { severity: 'warning', type: { name: 'int' } } },
        }, { headers: ['a'], rows: [['x']] });
        t.assertEq(warn.verdict, 'passWithWarnings', 'warning verdict');
        t.assertEq(warn.needsAttention, true, 'warnings need attention');

        const fail = mk({
            meta: META,
            columns: { a: { type: { name: 'int' } } },
        }, { headers: ['a'], rows: [['x'], ['y']] });
        t.assertEq(fail.verdict, 'fail', 'fail verdict');
        t.assertEq(fail.bySeverity.error, 2, 'violations counted');
        t.assertEq(fail.checksFailed, 1, 'distinct rule names');
        t.assertEq(fail.columnsAffected, 1, 'distinct columns');
        t.assertEq(fail.topIssues[0].ruleName, 'typeMismatch', 'top issue');

        const halted = mk(SIMPLE(), { headers: null, rows: [] });
        t.assertEq(halted.verdict, 'aborted', 'aborted verdict');
        t.assertEq(halted.aborted, true, 'aborted flag');
        t.assertEq(halted.abortReason, 'headersMissing', 'abortReason headersMissing');
        t.assertEq(halted.topIssues[0].severity, 'error', 'error tops the list');
    });

    U('exportXlsx — rejects without cellRegister; rejects without ExcelJS global', async (t) => {
        const schema = Object.assign(SIMPLE(), { resultConfig: { collectCellRegister: false } });
        const table = { headers: ['a'], rows: [['x']] };
        const noRegister = TV().validate(schema, table);
        let rejected = false;
        try { await TV().exportXlsx({ result: noRegister, table, schema }); }
        catch (e) { rejected = e.name === 'TableValidationConfigError'; }
        t.assert(rejected, 'missing cellRegister must reject with TableValidationConfigError');

        const saved = globalThis.ExcelJS;
        try {
            delete globalThis.ExcelJS;
            const schema2 = Object.assign(SIMPLE(), { resultConfig: { collectCellRegister: true } });
            const withRegister = TV().validate(schema2, table);
            let rejected2 = false;
            try { await TV().exportXlsx({ result: withRegister, table, schema: schema2 }); }
            catch (e) { rejected2 = e.name === 'TableValidationConfigError'; }
            t.assert(rejected2, 'missing ExcelJS global must reject with TableValidationConfigError');
        } finally {
            if (saved) globalThis.ExcelJS = saved;
        }
    });

    U('exportXlsx — produces an xlsx Blob for an invalid table (3 sheets, register required)', async (t) => {
        const schema = {
            meta: META,
            resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                id: { unique: { enabled: true }, type: { name: 'int' } },
                name: { type: { name: 'string' } },
            },
        };
        const table = { headers: ['id', 'name'], rows: [['1', 'a'], ['1', 'b'], ['x', 'c']] };
        const result = TV().validate(schema, table);
        t.assertEq(result.valid, false, 'fixture is invalid');
        const blob = await TV().exportXlsx({ result, table, schema });
        t.assert(blob instanceof Blob, 'returns a Blob');
        t.assertEq(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'MIME type');
        t.assert(blob.size > 1000, 'workbook has content');
    }, { needsExcelJS: true });

    U('exportXlsx — byPosition table exports with synthesized header row', async (t) => {
        const schema = {
            meta: META,
            resultConfig: { collectCellRegister: true },
            structure: { columnMatching: 'byPosition', allowExtraColumns: true },
            columns: { id: { type: { name: 'string' } } },
        };
        const table = { headers: null, rows: [[null], ['ok']] };
        const result = TV().validate(schema, table);
        const blob = await TV().exportXlsx({ result, table, schema });
        t.assert(blob instanceof Blob && blob.size > 500, 'byPosition export works');
    }, { needsExcelJS: true });

    U('usage example from JS spec §8 runs unmodified (core path)', (t) => {
        const schema = {
            meta: { schemaVersion: '1.0.0', name: 'deliveries' },
            resultConfig: { collectCellRegister: true },
            nullHandling: { nullEquivalents: ['', 'NA'] },
            evaluation: { strictType: false, timezone: 'Europe/Luxembourg' },
            structure: {
                columnMatching: 'byPosition',
                columnCount: { min: 3, max: 3, minInclusive: true, maxInclusive: true },
            },
            columns: {
                id: { type: { name: 'int' }, unique: { enabled: true } },
                amount: { type: { name: 'float', formats: [{ decimalSeparator: ',', groupingSeparators: [' '] }] } },
                day: { type: { name: 'date', formats: ['dd.MM.yyyy'] }, nullable: true },
            },
            customRowChecks: [
                { name: 'amountPositive', type: 'custom', fn: 'positive', severity: 'warning', params: { field: 'amount' } },
            ],
        };
        const table = TV().adapters.fromArrays([
            ['1', '1 234,50', '15.07.2026'],
            ['2', '-3,00', ''],
        ]);
        const result = TV().validate(schema, table, {
            functions: {
                positive: (row, interpreted, i, p) =>
                    interpreted[p.field] !== null && interpreted[p.field] <= 0
                        ? [{ field: p.field, pass: false, message: 'amount must be positive' }]
                        : [],
            },
            referenceInstant: '2026-07-08T12:00:00Z',
        });
        const report = TV().buildReport(result);
        t.assertEq(report.verdict, 'passWithWarnings', 'example verdict');
        t.assertEq(result.valid, true, 'example is valid');
        t.assertEq(result.validWithWarnings, true, 'with warnings');
        t.assertEq(result.summary.bySeverity.warning, 1, 'one warning (-3,00)');
    }, { needsLuxon: true });

    U('exportComparisonXlsx refuses without cellRegister (1.3.1)', async (t) => {
        const schema = {
            meta: META,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { id: { type: { name: 'int' } }, v: { type: { name: 'int' } } },
            comparison: { match: { keys: ['id'] } },
        };
        const produced = { headers: ['id', 'v'], rows: [['1', '2']] };
        const expected = { headers: ['id', 'v'], rows: [['1', '3']] };
        const noReg = TV().compare(schema, produced, expected);
        t.assert(!Array.isArray(noReg.cellRegister), 'fixture sanity: no register collected');
        let err = null;
        try { await TV().exportComparisonXlsx({ result: noReg, table: produced, schema, expected }); }
        catch (e) { err = e; }
        t.assert(err && err.name === 'TableValidationConfigError',
            'rejects with TableValidationConfigError (pre-1.3.1: silently empty Errors sheet)');
        t.assert(err && err.message.includes('collectCellRegister'), 'message names the missing setting');
        // with the register the export resolves to a Blob
        const schema2 = Object.assign({}, schema, { resultConfig: { collectCellRegister: true } });
        const withReg = TV().compare(schema2, produced, expected);
        const blob = await TV().exportComparisonXlsx({ result: withReg, table: produced, schema: schema2, expected });
        t.assert(blob instanceof Blob, 'resolves to a Blob with the register present');
    }, { needsExcelJS: true });

    U('export Go To + highlights (1.3.1)', async (t) => {
        // (a) validation export: an extraColumn entry links to the extra column's own header cell
        const schema = {
            meta: META, resultConfig: { collectCellRegister: true },
            columns: { a: { type: { name: 'string' } } },       // allowExtraColumns defaults to false
        };
        const table = { headers: ['a', 'extra'], rows: [['x', 'y']] };
        const result = TV().validate(schema, table);
        t.assert(result.cellRegister.some((e) => e.ruleName === 'extraColumn' && e.field === 'extra'),
            'fixture sanity: extraColumn against the raw header');
        const blob = await TV().exportXlsx({ result, table, schema });
        const wb = new globalThis.ExcelJS.Workbook();
        await wb.xlsx.load(await blob.arrayBuffer());
        let goTo = null;
        wb.getWorksheet('Errors').eachRow((row, n) => {
            if (n > 1 && row.getCell(3).value === 'extraColumn') goTo = row.getCell(8).value;
        });
        t.assert(goTo !== null && goTo.hyperlink === "#'Data'!B1",
            'Go To targets the extra column\'s own header cell, not A1');
        const hdr = wb.getWorksheet('Data').getRow(1).getCell(2);
        t.assert(hdr.fill && hdr.fill.fgColor && hdr.fill.fgColor.argb === 'FFFFC7CE',
            'extra column header carries the error severity fill');

        // (b) comparison export: the [t] type tag + the 9-column Errors sheet with Go To links
        const cschema = {
            meta: META, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { id: { type: { name: 'int' } }, v: { type: { name: 'skip' } } },
            comparison: { match: { keys: ['id'] } },
        };
        const produced = { headers: ['id', 'v'], rows: [[1, 1]] };
        const expected = { headers: ['id', 'v'], rows: [[1, 'x']] };
        const cres = TV().compare(cschema, produced, expected);
        t.assertEq(cres.diff.rows[0].cells.v.tier, 'crossTypeMismatch', 'fixture sanity: cross-type cell');
        const cblob = await TV().exportComparisonXlsx({ result: cres, table: produced, schema: cschema, expected });
        const cwb = new globalThis.ExcelJS.Workbook();
        await cwb.xlsx.load(await cblob.arrayBuffer());
        const vText = String(cwb.getWorksheet('Comparison').getRow(2).getCell(4).value);
        t.assert(vText.endsWith('[t]'), 'crossTypeMismatch cell text carries the [t] type tag');
        const cerrs = cwb.getWorksheet('Errors');
        t.assertEq(cerrs.getRow(1).values.slice(1),
            ['#', 'Severity', 'Check', 'Column', 'Row', 'Message', 'Scope', 'Match Status', 'Go To'],
            'Errors sheet: 9 columns incl. the Go To header');
        let entries = 0, links = 0;
        cerrs.eachRow((row, n) => {
            if (n === 1) return;
            entries++;
            const v = row.getCell(9).value;
            if (v && v.hyperlink) links++;
        });
        t.assert(entries > 0 && links === entries, 'every Errors entry carries a Go To hyperlink object');
    }, { needsExcelJS: true });

    // ---- Core §9.5 cellObservations channel (B029): gating, the six outcomes, worstSeverity.
    U('cellObservations — null unless collected; six-outcome matrix with worstSeverity', (t) => {
        // gating: absent when the flag is off
        const off = TV().validate(SIMPLE(), { headers: ['a'], rows: [['x']] });
        t.assertEq(off.cellObservations, null, 'null when collectCellObservations is off/absent');

        const schema = {
            meta: META,
            resultConfig: { collectCellObservations: true },
            structure: { allowMissingColumns: true },
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                s: { type: { name: 'string' } },                 // native (string cell → string)
                n: { type: { name: 'int' } },                    // interpreted (string→int) / violation
                nl: { nullable: true, type: { name: 'int' } },   // effectivelyNull (native null)
                w: { severity: 'warning', type: { name: 'int' } }, // violation @ worstSeverity 'warning'
                sk: { type: { name: 'skip' } },                  // skipped
                gone: { nullable: true, type: { name: 'string' } }, // absent → notChecked
            },
        };
        const table = {
            headers: ['s', 'n', 'nl', 'w', 'sk'],
            rows: [['hi', '5', null, 'bad', 'zz']],
        };
        const r = TV().validate(schema, table);
        t.assert(Array.isArray(r.cellObservations), 'observations collected');
        const at = (field) => r.cellObservations.find((o) => o.field === field && o.row === 0);

        t.partial({ outcome: 'native', interpretedValue: 'hi', worstSeverity: null }, at('s'), 'native (string)');
        t.partial({ outcome: 'interpreted', interpretedValue: 5, worstSeverity: null }, at('n'), 'interpreted (string→int)');
        t.partial({ outcome: 'effectivelyNull', rawValue: null, interpretedValue: null, worstSeverity: null },
            at('nl'), 'effectivelyNull (native null in nullable column)');
        t.partial({ outcome: 'violation', interpretedValue: null, worstSeverity: 'warning' },
            at('w'), 'violation carries worstSeverity of the firing rule (warning)');
        t.partial({ outcome: 'skipped', worstSeverity: null }, at('sk'), 'skipped (type skip)');
        t.partial({ outcome: 'notChecked', rawValue: null, interpretedValue: null, worstSeverity: null },
            at('gone'), 'notChecked (schema column absent from the table)');
    });

    // ---- exportAnnotatedXlsx (Core §9.5 / JS F6): refusal contract + per-observation tinting (B029).
    U('exportAnnotatedXlsx — refuses without observations / without ExcelJS; tints violation & interpreted cells', async (t) => {
        const E = 'TableValidationConfigError';
        const schema0 = SIMPLE();
        const table0 = { headers: ['a'], rows: [['x']] };
        // (a) refuses when observations were not collected
        const noObs = TV().validate(schema0, table0);
        let e1 = null;
        try { await TV().exportAnnotatedXlsx({ result: noObs, table: table0, schema: schema0 }); }
        catch (e) { e1 = e; }
        t.assert(e1 && e1.name === E && /cellObservations/.test(e1.message),
            'rejects without cellObservations, naming the missing setting');

        // (b) refuses when the ExcelJS global is unavailable
        const saved = globalThis.ExcelJS;
        try {
            delete globalThis.ExcelJS;
            const schemaO = Object.assign(SIMPLE(), { resultConfig: { collectCellObservations: true } });
            const withObs = TV().validate(schemaO, table0);
            let e2 = null;
            try { await TV().exportAnnotatedXlsx({ result: withObs, table: table0, schema: schemaO }); }
            catch (e) { e2 = e; }
            t.assert(e2 && e2.name === E, 'rejects without the ExcelJS global');
        } finally {
            if (saved) globalThis.ExcelJS = saved;
        }

        // (c) tints: single 'Annotated' sheet; violation cell → error fill, interpreted cell → interpreted fill
        const schema = {
            meta: META,
            resultConfig: { collectCellObservations: true },
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { type: { name: 'int' } }, b: { type: { name: 'string' } } },
        };
        const table = { headers: ['a', 'b'], rows: [['5', 'hi'], ['bad', 'yo']] };
        const result = TV().validate(schema, table);
        const blob = await TV().exportAnnotatedXlsx({ result, table, schema });
        t.assert(blob instanceof Blob && blob.size > 500, 'produces an xlsx Blob');
        const wb = new globalThis.ExcelJS.Workbook();
        await wb.xlsx.load(await blob.arrayBuffer());
        t.assertEq(wb.worksheets.map((w) => w.name), ['Annotated'], 'single Annotated sheet');
        const ws = wb.getWorksheet('Annotated');
        // data rows start at 2; col a is column 1
        const interp = ws.getRow(2).getCell(1);   // '5' → interpreted int
        t.assert(interp.fill && interp.fill.fgColor && interp.fill.fgColor.argb === 'FFDDEBF7',
            'interpreted cell carries the interpreted (blue) tint');
        const viol = ws.getRow(3).getCell(1);      // 'bad' → typeMismatch violation (error)
        t.assert(viol.fill && viol.fill.fgColor && viol.fill.fgColor.argb === 'FFFFC7CE',
            'violation cell carries the error (red) tint');
        const nativeCell = ws.getRow(2).getCell(2); // 'hi' native string → untinted
        t.assert(!nativeCell.fill || nativeCell.fill.pattern === undefined,
            'native cell is left untinted');
    }, { needsExcelJS: true });

    // ---- exportXlsx §9.4 sheet-level contract (B030): open the produced workbook and read it back.
    U('exportXlsx §9.4 — sheet order, header rows, error sort, Go To targets, highlights, missing column', async (t) => {
        const schema = {
            meta: META,
            resultConfig: { collectCellRegister: true },
            evaluation: { strictType: true, timezone: 'utc' },
            columns: {
                id: { type: { name: 'int' } },                        // error severity
                amt: { severity: 'warning', type: { name: 'int' } },  // warning severity
                note: { required: true, type: { name: 'string' } },   // absent → requiredColumnMissing (col-scoped error)
            },
        };
        const table = { headers: ['id', 'amt'], rows: [['x', '1'], ['2', 'y']] };
        const result = TV().validate(schema, table);
        t.assertEq(result.valid, false, 'fixture is invalid');
        const blob = await TV().exportXlsx({ result, table, schema });
        const wb = new globalThis.ExcelJS.Workbook();
        await wb.xlsx.load(await blob.arrayBuffer());

        // sheet names AND order
        t.assertEq(wb.worksheets.map((w) => w.name), ['Summary', 'Errors', 'Data'], 'three sheets in Summary/Errors/Data order');

        // header rows (column sets) for each sheet
        const errs = wb.getWorksheet('Errors');
        t.assertEq(errs.getRow(1).values.slice(1),
            ['#', 'Severity', 'Check', 'Column', 'Row', 'Value', 'Message', 'Go To'],
            'Errors sheet header (8 columns)');
        t.assertEq(wb.getWorksheet('Summary').getRow(1).values.slice(1),
            ['Severity', 'Check', 'Column', 'Message', 'Count', 'First Row', 'Sample Values'],
            'Summary sheet header (7 columns)');
        const data = wb.getWorksheet('Data');
        t.assertEq(data.getRow(1).values.slice(1), ['id', 'amt', 'note'],
            'Data header: table columns then the missing-column placeholder appended (byName)');

        // Errors rows: errors sort before warnings; Check + Go To pinned per row
        const rows = [];
        errs.eachRow((row, n) => {
            if (n === 1) return;
            const gt = row.getCell(8).value;
            rows.push({ sev: row.getCell(2).value, check: row.getCell(3).value,
                col: row.getCell(4).value, goTo: gt && gt.hyperlink });
        });
        t.assertEq(rows, [
            { sev: 'ERROR', check: 'requiredColumnMissing', col: 'note', goTo: "#'Data'!C1" }, // col-scoped → header cell
            { sev: 'ERROR', check: 'typeMismatch', col: 'id', goTo: "#'Data'!A2" },            // cell → data cell
            { sev: 'ERROR', check: 'typeMismatch', col: 'id', goTo: "#'Data'!A3" },
            { sev: 'WARNING', check: 'typeMismatch', col: 'amt', goTo: "#'Data'!B2" },
            { sev: 'WARNING', check: 'typeMismatch', col: 'amt', goTo: "#'Data'!B3" },
        ], 'errors-before-warnings sort with per-entry Go To targets');

        // data-cell highlights: error red on id[row0], warning yellow on amt[row1], error red on missing-col header
        t.assert(data.getRow(2).getCell(1).fill.fgColor.argb === 'FFFFC7CE', 'id row0 cell tinted error red');
        t.assert(data.getRow(3).getCell(2).fill.fgColor.argb === 'FFFFEB9C', 'amt row1 cell tinted warning yellow');
        t.assert(data.getRow(1).getCell(3).fill.fgColor.argb === 'FFFFC7CE', 'missing-column header tinted error red');

        // sheet formatting: frozen header row, autofilter across the used range, bold grey header
        t.assertEq(data.views[0].state, 'frozen', 'Data header row frozen');
        t.assertEq(data.views[0].ySplit, 1, 'freeze split at row 1');
        t.assertEq(data.autoFilter, 'A1:C3', 'autofilter spans header + data across all columns');
        t.assertEq(data.getRow(1).getCell(1).font.bold, true, 'header cells bold');
    }, { needsExcelJS: true });

    // ---- exportXlsx byPosition synthesized header note (B030 cont.)
    U('exportXlsx — byPosition Data sheet synthesizes a header row and notes it on A1', async (t) => {
        const schema = {
            meta: META,
            resultConfig: { collectCellRegister: true },
            structure: { columnMatching: 'byPosition' },
            columns: { a: { type: { name: 'int' } } },
        };
        const table = { headers: null, rows: [['x']] };
        const result = TV().validate(schema, table);
        const blob = await TV().exportXlsx({ result, table, schema });
        const wb = new globalThis.ExcelJS.Workbook();
        await wb.xlsx.load(await blob.arrayBuffer());
        const data = wb.getWorksheet('Data');
        t.assertEq(data.getRow(1).values.slice(1), ['a'], 'header synthesized from schema column names');
        t.assert(/synthesized/.test(String(data.getCell('A1').note || '')),
            'A1 carries the byPosition synthesized-header note');
    }, { needsExcelJS: true });
})();
