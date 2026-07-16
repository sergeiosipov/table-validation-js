/* Golden vectors — Phase 9 table-level checks: monotonic, sequenceNoGaps, sumEquals, custom. */
'use strict';
(function () {
    const V = (v) => window.__VECTORS__.push(Object.assign({ suite: 'table checks' }, v));
    const META = { schemaVersion: '1.0.0', name: 't' };
    const RC = { collectCellRegister: true };

    V({
        name: 'monotonic — break attributed to row N; null and uninterpretable cells skipped',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            nullHandling: { nullEquivalents: [''] },
            columns: { a: { nullable: true, type: { name: 'int' } } },
            customTableChecks: [{ name: 'mono', type: 'monotonic', field: 'a', direction: 'increasing' }],
        },
        table: { headers: ['a'], rows: [['1'], [''], ['3'], ['2'], ['x'], ['5']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 2 },                       // typeMismatch('x') + monotonic break
                byPhase: { cellValidation: 1, tableChecks: 1 },
                details: [
                    { ruleName: 'typeMismatch', count: 1 },
                    {
                        ruleName: 'monotonic:mono', fieldName: 'a', count: 1, firstOccurrenceRow: 3,
                        context: { field: 'a', direction: 'increasing' },
                        message: 'Rule "mono": breaks increasing order',
                    },
                ],
            },
            cellRegister: [
                { row: 4, ruleName: 'typeMismatch' },
                { row: 3, ruleName: 'monotonic:mono', value: '2' },
            ],
        },
    });

    V({
        name: 'sequenceNoGaps — gap attributed to smallest present value above the hole',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { type: { name: 'int' } } },
            customTableChecks: [{ name: 'seq', type: 'sequenceNoGaps', field: 'a', start: null }],
        },
        table: { headers: ['a'], rows: [[1], [2], [4]] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'sequenceNoGaps:seq', fieldName: 'a', count: 1, firstOccurrenceRow: 2,
                    context: { field: 'a', kind: 'gap', expectedValue: 3, actualValue: 4 },
                    message: 'Rule "seq": missing value 3 in sequence',
                }],
            },
            cellRegister: [{ row: 2, ruleName: 'sequenceNoGaps:seq', value: 4 }],
        },
    });

    V({
        name: 'sequenceNoGaps — duplicate occurrences flagged beyond the first',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { type: { name: 'int' } } },
            customTableChecks: [{ name: 'seq', type: 'sequenceNoGaps', field: 'a', start: null }],
        },
        table: { headers: ['a'], rows: [[1], [2], [2]] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2 } },              // 1 gap (3 missing) + 1 duplicate
            cellRegister: [
                { row: 1, ruleName: 'sequenceNoGaps:seq', context: { kind: 'gap', expectedValue: 3 } },
                {
                    row: 2, ruleName: 'sequenceNoGaps:seq',
                    context: { kind: 'duplicate', expectedValue: null, actualValue: 2 },
                    message: 'Rule "seq": duplicate sequence value 2',
                },
            ],
        },
    });

    V({
        name: 'sequenceNoGaps — belowStart with explicit start',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { type: { name: 'int' } } },
            customTableChecks: [{ name: 'seq', type: 'sequenceNoGaps', field: 'a', start: 5 }],
        },
        table: { headers: ['a'], rows: [[4], [5], [6]] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1 } },
            cellRegister: [{
                row: 0, ruleName: 'sequenceNoGaps:seq', value: 4,
                context: { kind: 'belowStart', expectedValue: null, actualValue: 4 },
                message: 'Rule "seq": value below sequence start',
            }],
        },
    });

    V({
        name: 'sumEquals — ONE violation, R×S entries (the counting model showcase)',
        schema: {
            meta: META, resultConfig: RC,
            columns: { x: { type: { name: 'int' } }, y: { type: { name: 'int' } } },
            customTableChecks: [{
                name: 'total', type: 'sumEquals', fields: ['x', 'y'],
                expectedValue: 10, expectedField: null,
            }],
        },
        table: { headers: ['x', 'y'], rows: [[1, 2], [3, 1]] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1, warning: 0 },   // ONE violation
                byPhase: { tableChecks: 1 },
                byColumn: { x: { error: 2 }, y: { error: 2 } },  // R×S = 4 entries
                details: [{
                    ruleName: 'sumEquals:total', fieldName: 'x', count: 2,
                    context: { fields: ['x', 'y'], expectedSum: 10, actualSum: 7, tolerance: 0 },
                    message: 'Rule "total": sum 7 ≠ expected 10 (±0)',
                }, { fieldName: 'y', count: 2 }],
            },
            cellRegister: [
                { row: 0, field: 'x', value: 1 }, { row: 0, field: 'y', value: 2 },
                { row: 1, field: 'x', value: 3 }, { row: 1, field: 'y', value: 1 },
            ],
        },
    });

    V({
        name: 'sumEquals — nulls count as 0; expectedField "last"; tolerance absorbs drift',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            nullHandling: { nullEquivalents: [''] },
            columns: {
                x: { nullable: true, type: { name: 'float' } },
                total: { nullable: true, type: { name: 'float' } },
            },
            customTableChecks: [{
                name: 'sum', type: 'sumEquals', fields: ['x'],
                expectedValue: null, expectedField: 'total', expectedFieldRow: 'last', tolerance: 0.5,
            }],
        },
        table: { headers: ['x', 'total'], rows: [['1.2', ''], [null, '1.0']] },
        expect: {
            valid: true,
            summary: { bySeverity: { error: 0, warning: 0 } },
            cellRegister: [],
        },
    });

    V({
        name: 'sumEquals exact (§7.2, 1.5.0) — ten "0.10" sum to exactly 1.00 and PASS at tolerance 0',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { x: { type: { name: 'float' } } },
            customTableChecks: [{
                name: 's', type: 'sumEquals', fields: ['x'],
                expectedValue: 1.00, expectedField: null, tolerance: 0, exact: true,
            }],
        },
        table: { headers: ['x'], rows: [['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10']] },
        expect: {
            valid: true,
            summary: { bySeverity: { error: 0, warning: 0 } },
            cellRegister: [],
        },
    });

    V({
        name: 'sumEquals exact opt-in (§7.2, 1.5.0) — the SAME check with exact:false FAILS on binary64 drift (proves opt-in + byte-identical default)',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { x: { type: { name: 'float' } } },
            customTableChecks: [{
                name: 's', type: 'sumEquals', fields: ['x'],
                expectedValue: 1.00, expectedField: null, tolerance: 0, exact: false,
            }],
        },
        table: { headers: ['x'], rows: [['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10'], ['0.10']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1, warning: 0 },
                details: [{
                    ruleName: 'sumEquals:s', fieldName: 'x', count: 10,
                    context: { expectedSum: 1, tolerance: 0 },   // binary64 sum ≠ 1 at tolerance 0
                }],
            },
        },
    });

    V({
        name: 'sumEquals exact (§7.2, 1.5.0) — a native-number cell contributes its canonical rendering and records its row in binary64FallbackRows; exact decimal strings at scale s',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { x: { type: { name: 'float' } } },
            customTableChecks: [{
                name: 's', type: 'sumEquals', fields: ['x'],
                expectedValue: 5.00, expectedField: null, tolerance: 0, exact: true,
            }],
        },
        table: { headers: ['x'], rows: [['0.10'], [0.2], ['0.30']] },   // row 1 is a native number
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1, warning: 0 },
                details: [{
                    ruleName: 'sumEquals:s', fieldName: 'x', count: 3,
                    context: {
                        fields: ['x'], expectedSum: '5.00', actualSum: '0.60',
                        tolerance: 0, exact: true, binary64FallbackRows: [1],
                    },
                    message: 'Rule "s": sum 0.60 ≠ expected 5.00 (±0)',
                }],
            },
        },
    });

    V({
        name: 'custom table check — (row, field) fails become violations',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { type: { name: 'string' } } },
            customTableChecks: [{ name: 'tcheck', type: 'custom', fn: 'flagFirst' }],
        },
        functions: {
            flagFirst: (rows, interpreted, params) =>
                rows.length ? [{ row: 0, field: 'a', pass: false, message: 'bad' }] : [],
        },
        table: { headers: ['a'], rows: [['x'], ['y']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                byPhase: { tableChecks: 1 },
                details: [{
                    ruleName: 'custom:tcheck', fieldName: 'a', count: 1,
                    context: { fn: 'flagFirst', userMessage: 'bad' }, message: 'bad',
                }],
            },
            cellRegister: [{ row: 0, field: 'a', ruleName: 'custom:tcheck', value: 'x' }],
        },
    });

    V({
        name: 'custom table check — duplicate (row, field) results halt with contract violation',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { type: { name: 'string' } } },
            customTableChecks: [{ name: 'dup', type: 'custom', fn: 'dupfn' }],
        },
        functions: {
            dupfn: () => [
                { row: 0, field: 'a', pass: false, message: null },
                { row: 0, field: 'a', pass: false, message: null },
            ],
        },
        table: { headers: ['a'], rows: [['x']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'customFunctionContractViolation:dup', severity: 'error',
                    context: { fn: 'dupfn', duplicateKey: '(0, a)' },
                }],
            },
        },
    });
})();
