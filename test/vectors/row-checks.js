/* Golden vectors — Phase 8 row-level cross-column checks + custom function contracts. */
'use strict';
(function () {
    const V = (v) => window.__VECTORS__.push(Object.assign({ suite: 'row checks' }, v));
    const META = { schemaVersion: '1.0.0', name: 't' };
    const RC = { collectCellRegister: true };

    V({
        name: 'comparison — fails emit two entries; null/uninterpretable operands are SKIPPED',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            nullHandling: { nullEquivalents: [''] },
            columns: {
                a: { nullable: true, type: { name: 'int' } },
                b: { nullable: true, type: { name: 'int' } },
            },
            customRowChecks: [{ name: 'ab', type: 'comparison', fieldA: 'a', fieldB: 'b', op: '<' }],
        },
        table: { headers: ['a', 'b'], rows: [['1', '2'], ['3', '2'], ['', '2'], ['x', '2']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 2 },                                    // 1 typeMismatch + 1 comparison
                byPhase: { cellValidation: 1, rowCrossColumnChecks: 1 },
                byColumn: { a: { error: 2 }, b: { error: 1 } },
                details: [
                    { ruleName: 'typeMismatch', fieldName: 'a', count: 1 },
                    {
                        ruleName: 'comparison:ab', fieldName: 'a', count: 1,
                        context: { fieldA: 'a', fieldB: 'b', op: '<' },
                        message: 'Rule "ab": a < b violated',
                    },
                    { ruleName: 'comparison:ab', fieldName: 'b', count: 1 },
                ],
            },
            cellRegister: [
                { row: 3, field: 'a', ruleName: 'typeMismatch' },
                { row: 1, field: 'a', ruleName: 'comparison:ab', value: '3' },
                { row: 1, field: 'b', ruleName: 'comparison:ab', value: '2' },
            ],
        },
    });

    V({
        name: 'conditionalRequired — condition met + null target; null condition cell skips',
        schema: {
            meta: META, resultConfig: RC,
            nullHandling: { nullEquivalents: [''] },
            columns: {
                status: { nullable: true, type: { name: 'categorical', allowedValues: ['closed', 'open'] } },
                note: { nullable: true, type: { name: 'string' } },
            },
            customRowChecks: [{
                name: 'needNote', type: 'conditionalRequired',
                if: { field: 'status', op: '==', value: 'closed' },
                then: { field: 'note', nonNull: true },
            }],
        },
        table: {
            headers: ['status', 'note'],
            rows: [['closed', 'x'], ['closed', ''], ['open', ''], ['', '']],
        },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                byColumn: { status: { error: 1 }, note: { error: 1 } },
                details: [{
                    ruleName: 'conditionalRequired:needNote', fieldName: 'status', count: 1,
                    context: { ifField: 'status', ifOp: '==', ifValue: 'closed', thenField: 'note' },
                    message: 'Rule "needNote": note required when status == "closed"',
                }, {
                    ruleName: 'conditionalRequired:needNote', fieldName: 'note', count: 1,
                }],
            },
            cellRegister: [
                { row: 1, field: 'status', ruleName: 'conditionalRequired:needNote' },
                { row: 1, field: 'note', ruleName: 'conditionalRequired:needNote' },
            ],
        },
    });

    V({
        name: 'nonNullCount — entries for every listed field on each failing row',
        schema: {
            meta: META, resultConfig: RC,
            nullHandling: { nullEquivalents: [''] },
            columns: {
                a: { nullable: true, type: { name: 'string' } },
                b: { nullable: true, type: { name: 'string' } },
                c: { nullable: true, type: { name: 'string' } },
            },
            customRowChecks: [{ name: 'one', type: 'nonNullCount', fields: ['a', 'b', 'c'], expected: 1 }],
        },
        table: {
            headers: ['a', 'b', 'c'],
            rows: [['x', '', ''], ['x', 'y', ''], ['', '', '']],
        },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 2 },                        // 2 violations…
                byColumn: { a: { error: 2 }, b: { error: 2 }, c: { error: 2 } },   // …6 entries
                details: [{
                    ruleName: 'nonNullCount:one', fieldName: 'a', count: 2,
                    context: { fields: ['a', 'b', 'c'], expected: 1, actual: 2 },
                    message: 'Rule "one": 2 of a, b, c filled; expected exactly 1',
                }, { fieldName: 'b', count: 2 }, { fieldName: 'c', count: 2 }],
            },
        },
    });

    V({
        name: 'cooccurrence — some present, some missing',
        schema: {
            meta: META, resultConfig: RC,
            nullHandling: { nullEquivalents: [''] },
            columns: {
                a: { nullable: true, type: { name: 'string' } },
                b: { nullable: true, type: { name: 'string' } },
            },
            customRowChecks: [{ name: 'pair', type: 'cooccurrence', fields: ['a', 'b'] }],
        },
        table: { headers: ['a', 'b'], rows: [['x', 'y'], ['x', ''], ['', '']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'cooccurrence:pair', fieldName: 'a', count: 1,
                    context: { fields: ['a', 'b'], presentFields: ['a'], missingFields: ['b'] },
                    message: 'Rule "pair": fields must be filled together; missing b',
                }, { fieldName: 'b', count: 1 }],
            },
            cellRegister: [
                { row: 1, field: 'a', ruleName: 'cooccurrence:pair' },
                { row: 1, field: 'b', ruleName: 'cooccurrence:pair' },
            ],
        },
    });

    V({
        name: 'custom row check — warning severity, userMessage, null interpreted for null cells',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            nullHandling: { nullEquivalents: [''] },
            columns: { amount: { nullable: true, type: { name: 'float' } } },
            customRowChecks: [{
                name: 'amountPositive', type: 'custom', fn: 'positive',
                severity: 'warning', params: { field: 'amount' },
            }],
        },
        functions: {
            positive: (row, interpreted, i, p) =>
                interpreted[p.field] !== null && interpreted[p.field] <= 0
                    ? [{ field: p.field, pass: false, message: 'amount must be positive' }]
                    : [],
        },
        table: { headers: ['amount'], rows: [['5'], ['-1'], ['']] },
        expect: {
            valid: true, validWithWarnings: true,
            summary: {
                bySeverity: { error: 0, warning: 1 },
                details: [{
                    ruleName: 'custom:amountPositive', severity: 'warning', fieldName: 'amount', count: 1,
                    context: { fn: 'positive', userMessage: 'amount must be positive' },
                    message: 'amount must be positive',
                }],
            },
            cellRegister: [{ row: 1, field: 'amount', ruleName: 'custom:amountPositive', value: '-1' }],
        },
    });

    V({
        name: 'customFunctionError — thrown error halts with message in context',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { type: { name: 'string' } } },
            customRowChecks: [{ name: 'crash', type: 'custom', fn: 'bad' }],
        },
        functions: { bad: () => { throw new Error('boom'); } },
        table: { headers: ['a'], rows: [['x']] },
        expect: {
            valid: false, truncated: false,
            summary: {
                bySeverity: { error: 1 },
                byPhase: { rowCrossColumnChecks: 1 },
                details: [{
                    ruleName: 'customFunctionError:crash', severity: 'error',
                    context: { fn: 'bad', errorMessage: 'boom' },
                    message: 'Check "crash" crashed: boom',
                }],
            },
        },
    });

    V({
        name: 'customFunctionContractViolation — duplicate field results halt',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { type: { name: 'string' } } },
            customRowChecks: [{ name: 'dup', type: 'custom', fn: 'dupfn' }],
        },
        functions: {
            dupfn: () => [
                { field: 'a', pass: false, message: null },
                { field: 'a', pass: false, message: null },
            ],
        },
        table: { headers: ['a'], rows: [['x']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'customFunctionContractViolation:dup', severity: 'error',
                    context: { fn: 'dupfn', duplicateKey: 'a' },
                    message: 'Check "dup" returned duplicate results for a',
                }],
            },
        },
    });
})();
