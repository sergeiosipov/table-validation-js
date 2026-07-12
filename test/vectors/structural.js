/* Golden vectors — Phases 4/5 structural checks, both matching modes, gates. */
'use strict';
(function () {
    const V = (v) => window.__VECTORS__.push(Object.assign({ suite: 'structural' }, v));
    const META = { schemaVersion: '1.0.0', name: 't' };
    const RC = { collectCellRegister: true };

    V({
        name: 'headersMissing — byName with null headers halts',
        schema: { meta: META, resultConfig: RC, columns: { a: { type: { name: 'string' } } } },
        table: { headers: null, rows: [['x']] },
        expect: {
            valid: false,
            summary: {
                rowsChecked: 0, columnsChecked: 0,
                bySeverity: { error: 1, warning: 0 },
                byPhase: { structuralColumnChecks: 1 },
                byColumn: { _table: { error: 1 } },
                details: [{
                    ruleName: 'headersMissing', severity: 'error', fieldName: null,
                    context: { columnMatching: 'byName' },
                    message: 'Table has no header row but column matching is "byName"',
                }],
            },
            cellRegister: [{ row: null, field: null, ruleName: 'headersMissing' }],
        },
    });

    V({
        name: 'columnCountBreach + requiredColumnMissing — byPosition with too few columns',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'utc' },
            structure: {
                columnMatching: 'byPosition',
                columnCount: { min: 2, max: 2, minInclusive: true, maxInclusive: true },
            },
            columns: { a: { type: { name: 'string' } }, b: { type: { name: 'string' } } },
        },
        table: { headers: null, rows: [['x']] },
        expect: {
            valid: false,
            summary: {
                rowsChecked: 1, columnsChecked: 1, columnMatching: 'byPosition',
                bySeverity: { error: 2, warning: 0 },
                byPhase: { structuralColumnChecks: 2, structuralRowChecks: 0, cellValidation: 0 },
                byColumn: { _table: { error: 1 }, b: { error: 1 } },
            },
            cellRegister: [
                {
                    ruleName: 'columnCountBreach', row: null, field: null,
                    context: { actual: 1, min: 2, max: 2, minInclusive: true, maxInclusive: true },
                    message: '1 columns; expected 2–2',
                },
                { ruleName: 'requiredColumnMissing', row: null, field: 'b', context: { expectedPosition: 1 } },
            ],
        },
    });

    V({
        name: 'duplicateColumnName — strategy "halt" stops validation',
        schema: { meta: META, resultConfig: RC, columns: { a: { type: { name: 'string' } } } },
        table: { headers: ['a', 'a'], rows: [['x', 'y']] },
        expect: {
            valid: false,
            summary: {
                columnsChecked: 0,
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'duplicateColumnName', severity: 'error', fieldName: 'a',
                    context: { strategy: 'halt', occurrences: 2, resolvedNames: null, droppedIndices: null },
                }],
            },
        },
    });

    V({
        name: 'duplicateColumnName — strategy "rename" warns, both instances validated',
        schema: {
            meta: META, resultConfig: RC,
            structure: { duplicateColumnNames: { strategy: 'rename', renamePattern: '{name}~{index}' } },
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a', 'a'], rows: [['x', 'y']] },
        expect: {
            valid: true, validWithWarnings: true,
            summary: {
                columnsChecked: 1,
                bySeverity: { error: 0, warning: 1 },
                byColumn: { a: { warning: 1 } },
                details: [{
                    ruleName: 'duplicateColumnName', severity: 'warning', fieldName: 'a',
                    context: { strategy: 'rename', occurrences: 2, resolvedNames: ['a~0', 'a~1'], droppedIndices: [] },
                    message: 'Duplicate header ×2; strategy "rename" applied',
                }],
            },
        },
    });

    V({
        name: 'duplicateColumnName — strategy "keepFirst" warns; dropped duplicate becomes extraColumn',
        schema: {
            meta: META, resultConfig: RC,
            structure: { duplicateColumnNames: { strategy: 'keepFirst' } },
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a', 'a'], rows: [['x', 'y']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1, warning: 1 },
                byColumn: { a: { error: 1, warning: 1 } },
            },
            cellRegister: [
                {
                    ruleName: 'duplicateColumnName', severity: 'warning', field: 'a',
                    context: { strategy: 'keepFirst', occurrences: 2, resolvedNames: ['a'], droppedIndices: [1] },
                },
                {
                    ruleName: 'extraColumn', severity: 'error', field: 'a',
                    context: { position: 1, headerName: 'a' },
                },
            ],
        },
    });

    V({
        name: 'requiredColumnMissing — byName (expectedPosition null)',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { type: { name: 'string' } }, b: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [['x']] },
        expect: {
            valid: false,
            summary: {
                columnsChecked: 1,
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'requiredColumnMissing', fieldName: 'b',
                    context: { expectedPosition: null },
                    message: 'Required column is missing',
                }],
            },
        },
    });

    V({
        name: 'extraColumn — byName (column-scoped, header name in field)',
        schema: { meta: META, resultConfig: RC, columns: { a: { type: { name: 'string' } } } },
        table: { headers: ['a', 'x'], rows: [['1', '2']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                byColumn: { x: { error: 1 } },
                details: [{
                    ruleName: 'extraColumn', fieldName: 'x',
                    context: { position: 1, headerName: 'x' },
                    message: 'Unexpected extra column at position 1',
                }],
            },
            cellRegister: [{ ruleName: 'extraColumn', row: null, field: 'x' }],
        },
    });

    V({
        name: 'extraColumn — byPosition (table-scoped, position in context)',
        schema: {
            meta: META, resultConfig: RC,
            structure: { columnMatching: 'byPosition' },
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: null, rows: [['1', '2']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                byColumn: { _table: { error: 1 } },
                details: [{
                    ruleName: 'extraColumn', fieldName: null,
                    context: { position: 1, headerName: null },
                }],
            },
            cellRegister: [{ ruleName: 'extraColumn', row: null, field: null }],
        },
    });

    V({
        name: 'columnOrderViolation — byName with enforceColumnOrder',
        schema: {
            meta: META, resultConfig: RC,
            structure: { enforceColumnOrder: true },
            columns: { a: { type: { name: 'string' } }, b: { type: { name: 'string' } } },
        },
        table: { headers: ['b', 'a'], rows: [['x', 'y']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 2 },
                byColumn: { a: { error: 1 }, b: { error: 1 } },
            },
            cellRegister: [
                {
                    ruleName: 'columnOrderViolation', field: 'a',
                    context: { expectedPosition: 0, actualPosition: 1 },
                    message: 'Column at position 1; expected 0',
                },
                { ruleName: 'columnOrderViolation', field: 'b', context: { expectedPosition: 1, actualPosition: 0 } },
            ],
        },
    });

    V({
        name: 'allNullColumn — with column-level severity and nullEquivalents',
        schema: {
            meta: META, resultConfig: RC,
            nullHandling: { nullEquivalents: [''] },
            structure: { allowAllNullColumns: false },
            columns: {
                a: { nullable: true, type: { name: 'string' } },
                b: { type: { name: 'string' } },
            },
        },
        table: { headers: ['a', 'b'], rows: [['', 'x'], ['', 'y']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                byColumn: { a: { error: 1 } },
                details: [{
                    ruleName: 'allNullColumn', fieldName: 'a', context: {},
                    message: 'Every value in the column is null',
                }],
            },
            cellRegister: [{ ruleName: 'allNullColumn', row: null, field: 'a' }],
        },
    });

    V({
        name: 'duplicateColumnContent — second column flagged with duplicateOfColumn',
        schema: {
            meta: META, resultConfig: RC,
            structure: { allowDuplicateColumns: false },
            columns: { a: { type: { name: 'string' } }, b: { type: { name: 'string' } } },
        },
        table: { headers: ['a', 'b'], rows: [['x', 'x'], ['y', 'y']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'duplicateColumnContent', fieldName: 'b',
                    context: { duplicateOfColumn: 'a' },
                    message: 'Column content identical to "a"',
                }],
            },
        },
    });

    V({
        name: 'rowCountBreach — table-scoped entry',
        schema: {
            meta: META, resultConfig: RC,
            structure: { rowCount: { min: 2, max: null, minInclusive: true, maxInclusive: true } },
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [['x']] },
        expect: {
            valid: false,
            summary: {
                rowsChecked: 1,
                bySeverity: { error: 1 },
                byPhase: { structuralRowChecks: 1 },
                byColumn: { _table: { error: 1 } },
                details: [{
                    ruleName: 'rowCountBreach', fieldName: null,
                    context: { actual: 1, min: 2, max: null },
                    message: '1 rows; expected 2–∞',
                }],
            },
        },
    });

    V({
        name: 'allNullRow — row-scoped entry',
        schema: {
            meta: META, resultConfig: RC,
            nullHandling: { nullEquivalents: ['NA'] },
            structure: { allowAllNullRows: false },
            columns: {
                a: { nullable: true, type: { name: 'string' } },
                b: { nullable: true, type: { name: 'string' } },
            },
        },
        table: { headers: ['a', 'b'], rows: [['NA', null], ['x', 'y']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                byColumn: { _table: { error: 1 } },
                details: [{
                    ruleName: 'allNullRow', fieldName: null, firstOccurrenceRow: 0, context: {},
                    message: 'Every value in the row is null',
                }],
            },
            cellRegister: [{ ruleName: 'allNullRow', row: 0, field: null }],
        },
    });

    V({
        name: 'duplicateRow — interpreted equality ("01" duplicates 1 in a non-strict int column)',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            structure: { allowDuplicateRows: false },
            columns: { id: { type: { name: 'int' } } },
        },
        table: { headers: ['id'], rows: [['01'], [1], ['2']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'duplicateRow', fieldName: null, firstOccurrenceRow: 1,
                    context: { duplicateOfRow: 0 },
                    message: 'Duplicate of row 1',
                }],
            },
            cellRegister: [{ ruleName: 'duplicateRow', row: 1, field: null }],
        },
    });

    V({
        name: 'GATE 1 — stopOnFail requiredColumnMissing aborts, skips Phases 5–9',
        schema: {
            meta: META, resultConfig: RC,
            columns: {
                a: {
                    type: {
                        name: 'string',
                        length: { min: 1, max: 2, minInclusive: true, maxInclusive: true },
                    },
                },
                b: { severity: 'error', stopOnFail: true, type: { name: 'string' } },
            },
        },
        table: { headers: ['a'], rows: [['zzzz']] },      // 'zzzz' would breach length if Phase 6 ran
        expect: {
            valid: false,
            aborted: true, abortReason: 'stopOnFail:b',
            summary: {
                rowsChecked: 0,
                bySeverity: { error: 1 },
                byPhase: { structuralColumnChecks: 1, structuralRowChecks: 0, cellValidation: 0 },
                details: [{ ruleName: 'requiredColumnMissing', severity: 'error', fieldName: 'b' }],
            },
        },
    });

    V({
        name: 'GATE 2 — zero rows skip Phases 6–9',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { unique: { enabled: true }, nullable: true, type: { name: 'int' } } },
            customTableChecks: [{ name: 'mono', type: 'monotonic', field: 'a', direction: 'increasing' }],
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: true, validWithWarnings: false,
            summary: {
                rowsChecked: 0, columnsChecked: 1,
                bySeverity: { error: 0, warning: 0 },
                byPhase: {
                    structuralColumnChecks: 0, structuralRowChecks: 0, cellValidation: 0,
                    columnAggregateChecks: 0, rowCrossColumnChecks: 0, tableChecks: 0,
                },
            },
            cellRegister: [],
        },
    });
})();
