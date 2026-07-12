/* Golden vectors — circuit breakers (maxErrors, maxErrorsPerColumn). */
'use strict';
(function () {
    const V = (v) => window.__VECTORS__.push(Object.assign({ suite: 'circuit breakers' }, v));
    const META = { schemaVersion: '1.0.0', name: 't' };

    V({
        name: 'maxErrors — stops all validation at the limit; later phases never run',
        schema: {
            meta: META,
            resultConfig: { collectCellRegister: true, maxErrors: 2 },
            evaluation: { strictType: true, timezone: 'utc' },
            columns: { a: { type: { name: 'int' } } },
            customTableChecks: [{ name: 'mono', type: 'monotonic', field: 'a', direction: 'increasing' }],
        },
        table: { headers: ['a'], rows: [['x'], ['y'], ['z'], ['w']] },
        expect: {
            valid: false,
            truncated: true, truncationReason: 'maxErrors',
            summary: {
                rowsChecked: 4,
                bySeverity: { error: 2 },
                byPhase: { cellValidation: 2, tableChecks: 0 },
                truncatedColumns: [],
                details: [{ ruleName: 'typeMismatch', count: 2, topSampleRows: [0, 1] }],
            },
            cellRegister: [
                { row: 0, ruleName: 'typeMismatch', value: 'x' },
                { row: 1, ruleName: 'typeMismatch', value: 'y' },
            ],
        },
    });

    V({
        name: 'maxErrorsPerColumn — skips remaining rows for the column; aggregates run on checked rows',
        schema: {
            meta: META,
            resultConfig: { collectCellRegister: true, maxErrorsPerColumn: 2 },
            evaluation: { strictType: true, timezone: 'utc' },
            columns: {
                a: { unique: { enabled: true }, type: { name: 'int' } },
                b: { type: { name: 'string' } },
            },
        },
        table: { headers: ['a', 'b'], rows: [['x', 'k1'], ['x', 'k2'], ['x', 'k3']] },
        expect: {
            valid: false,
            truncated: true, truncationReason: 'maxErrorsPerColumn',
            summary: {
                rowsChecked: 3,
                bySeverity: { error: 4 },              // 2 typeMismatch + 2 uniqueness (rows 0–1 only)
                byPhase: { cellValidation: 2, columnAggregateChecks: 2 },
                truncatedColumns: ['a'],
                byColumn: { a: { error: 4 } },
            },
            cellRegister: [
                { row: 0, ruleName: 'typeMismatch' },
                { row: 1, ruleName: 'typeMismatch' },
                { row: 0, ruleName: 'uniquenessViolation', context: { duplicateOfRow: null } },
                { row: 1, ruleName: 'uniquenessViolation', context: { duplicateOfRow: 0 } },
            ],
        },
    });
})();
