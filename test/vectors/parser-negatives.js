/* Parser negative tests — partial parses and whitespace MUST be rejected (Core §1.5, §13.2). */
'use strict';
(function () {
    const V = (v) => window.__VECTORS__.push(Object.assign({ suite: 'parser negatives' }, v));
    const META = { schemaVersion: '1.0.0', name: 't' };
    const RC = { collectCellRegister: true };

    V({
        name: 'int direct parse rejects "12abc", "", " 1", "1,2,3"',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { type: { name: 'int' } } },
        },
        table: { headers: ['a'], rows: [['12abc'], [''], [' 1'], ['1,2,3'], ['12']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 4 },
                details: [{ ruleName: 'typeMismatch', fieldName: 'a', count: 4, topSampleRows: [0, 1, 2, 3] }],
            },
            cellRegister: [
                { row: 0, ruleName: 'typeMismatch', value: '12abc' },
                { row: 1, ruleName: 'typeMismatch', value: '' },
                { row: 2, ruleName: 'typeMismatch', value: ' 1' },
                { row: 3, ruleName: 'typeMismatch', value: '1,2,3' },
            ],
        },
    });

    V({
        name: 'float direct parse rejects "1.", ".5", " 1", "12abc", "1,2,3"; accepts "1.5"',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { type: { name: 'float' } } },
        },
        table: { headers: ['a'], rows: [['1.'], ['.5'], [' 1'], ['12abc'], ['1,2,3'], ['1.5']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 5 },
                details: [{ ruleName: 'typeMismatch', fieldName: 'a', count: 5 }],
            },
            cellRegister: [
                { row: 0, value: '1.' },
                { row: 1, value: '.5' },
                { row: 2, value: ' 1' },
                { row: 3, value: '12abc' },
                { row: 4, value: '1,2,3' },
            ],
        },
    });

    V({
        name: 'NumberFormat — two decimal separator occurrences yield no interpretation',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: { type: { name: 'float', formats: [{ decimalSeparator: ',', groupingSeparators: [] }] } },
            },
        },
        table: { headers: ['a'], rows: [['1,2,3'], ['1,5']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1 } },
            cellRegister: [{ row: 0, ruleName: 'typeMismatch', value: '1,2,3' }],
        },
    });
})();
