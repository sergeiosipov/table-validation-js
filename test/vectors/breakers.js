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

    // ---- resultConfig.stopPolicy 'firstError' (Core §2.2:283, §5.2) — a POLICY abort
    // (sets aborted/abortReason), distinct from the volume breakers above (truncated).
    V({
        name: 'stopPolicy firstError — first error violation aborts; later phases never run',
        schema: {
            meta: META,
            resultConfig: { collectCellRegister: true, stopPolicy: 'firstError' },
            evaluation: { strictType: true, timezone: 'utc' },
            columns: { a: { type: { name: 'int' } } },
            // a later phase that would ALSO fire, proving the abort short-circuits everything after it:
            customTableChecks: [{ name: 'mono', type: 'monotonic', field: 'a', direction: 'increasing' }],
        },
        table: { headers: ['a'], rows: [['x'], ['y'], ['z']] },
        expect: {
            valid: false,
            aborted: true, abortReason: 'stopPolicy',
            truncated: false, truncationReason: null,
            summary: {
                bySeverity: { error: 1, warning: 0 },
                byPhase: { cellValidation: 1, tableChecks: 0 },
            },
            cellRegister: [
                { row: 0, field: 'a', ruleName: 'typeMismatch', value: 'x' },
            ],
        },
    });

    V({
        name: 'stopPolicy firstError — warning-severity violations never trigger the abort',
        schema: {
            meta: META,
            resultConfig: { collectCellRegister: true, stopPolicy: 'firstError' },
            evaluation: { strictType: true, timezone: 'utc' },
            columns: { a: { severity: 'warning', type: { name: 'int' } } },
        },
        table: { headers: ['a'], rows: [['x'], ['y'], ['z']] },
        expect: {
            valid: true, validWithWarnings: true,
            aborted: false, abortReason: null,
            truncated: false,
            summary: {
                rowsChecked: 3,
                bySeverity: { error: 0, warning: 3 },
            },
        },
    });

    // ---- per-column stopOnFail (Core §10 rule 54, §2.2) — a POLICY abort keyed to the column.
    // Existing coverage (structural.js:335) is Phase-4 only; these pin Phase-6 and Phase-7a,
    // plus the §2.2/§8.10 warning carve-out (aborted:true yet valid:true).
    V({
        name: 'stopOnFail — a Phase-6 cell violation aborts the whole run (abortReason keyed to the column)',
        schema: {
            meta: META,
            resultConfig: { collectCellRegister: true },
            evaluation: { strictType: true, timezone: 'utc' },
            columns: { a: { stopOnFail: true, type: { name: 'int' } } },
            customTableChecks: [{ name: 'mono', type: 'monotonic', field: 'a', direction: 'increasing' }],
        },
        table: { headers: ['a'], rows: [['x'], ['y'], ['z']] },
        expect: {
            valid: false,
            aborted: true, abortReason: 'stopOnFail:a',
            truncated: false,
            summary: {
                bySeverity: { error: 1, warning: 0 },
                byPhase: { cellValidation: 1, tableChecks: 0 },
            },
            cellRegister: [
                { row: 0, field: 'a', ruleName: 'typeMismatch', value: 'x' },
            ],
        },
    });

    V({
        name: 'stopOnFail — a Phase-7a uniqueness violation aborts on the first duplicate',
        schema: {
            meta: META,
            resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { stopOnFail: true, unique: { enabled: true }, type: { name: 'int' } } },
            customTableChecks: [{ name: 'mono', type: 'monotonic', field: 'a', direction: 'increasing' }],
        },
        table: { headers: ['a'], rows: [['5'], ['5'], ['5']] },
        expect: {
            valid: false,
            aborted: true, abortReason: 'stopOnFail:a',
            summary: {
                bySeverity: { error: 1, warning: 0 },
                byPhase: { cellValidation: 0, columnAggregateChecks: 1, tableChecks: 0 },
            },
            cellRegister: [
                { row: 0, field: 'a', ruleName: 'uniquenessViolation', value: '5',
                  context: { duplicateOfRow: null } },
            ],
        },
    });

    V({
        name: 'stopOnFail — a WARNING-severity violation aborts yet leaves the run valid (Core §2.2/§8.10 carve-out)',
        schema: {
            meta: META,
            resultConfig: { collectCellRegister: true },
            evaluation: { strictType: true, timezone: 'utc' },
            columns: { a: { stopOnFail: true, severity: 'warning', type: { name: 'int' } } },
            customTableChecks: [{ name: 'mono', type: 'monotonic', field: 'a', direction: 'increasing' }],
        },
        table: { headers: ['a'], rows: [['x'], ['y']] },
        expect: {
            valid: true, validWithWarnings: true,     // records no error -> stays valid despite aborting
            aborted: true, abortReason: 'stopOnFail:a',
            truncated: false,
            summary: {
                bySeverity: { error: 0, warning: 1 },
                byPhase: { cellValidation: 1, tableChecks: 0 },
            },
            cellRegister: [
                { row: 0, field: 'a', severity: 'warning', ruleName: 'typeMismatch', value: 'x' },
            ],
        },
    });
})();
