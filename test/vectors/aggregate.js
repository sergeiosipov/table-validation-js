/* Golden vectors — Phase 7 uniqueness & composite keys (interpreted-value equality). */
'use strict';
(function () {
    const V = (v) => window.__VECTORS__.push(Object.assign({ suite: 'column aggregates' }, v));
    const META = { schemaVersion: '1.0.0', name: 't' };
    const RC = { collectCellRegister: true };

    V({
        name: 'uniquenessViolation — every occurrence flagged incl. first; "01" collides with 1',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { unique: { enabled: true }, type: { name: 'int' } } },
        },
        table: { headers: ['a'], rows: [['01'], [1], ['2']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 2 },
                byPhase: { columnAggregateChecks: 2 },
                byColumn: { a: { error: 2 } },
                details: [{
                    ruleName: 'uniquenessViolation', fieldName: 'a', count: 2, firstOccurrenceRow: 0,
                    message: 'Duplicate value',
                }],
            },
            cellRegister: [
                {
                    row: 0, field: 'a', ruleName: 'uniquenessViolation', value: '01',
                    context: { nullsEqual: false, duplicateOfRow: null }, message: 'Duplicate value',
                },
                {
                    row: 1, field: 'a', ruleName: 'uniquenessViolation', value: 1,
                    context: { nullsEqual: false, duplicateOfRow: 0 },
                    message: 'Duplicate value; first at row 1',
                },
            ],
        },
    });

    V({
        name: 'uniqueness nullsEqual true — at most one effectively-null cell',
        schema: {
            meta: META, resultConfig: RC,
            nullHandling: { nullEquivalents: ['NA'] },
            columns: {
                a: { nullable: true, unique: { enabled: true, nullsEqual: true }, type: { name: 'string' } },
            },
        },
        table: { headers: ['a'], rows: [['NA'], [null], ['x']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2 } },
            cellRegister: [
                { row: 0, ruleName: 'uniquenessViolation', context: { nullsEqual: true, duplicateOfRow: null } },
                { row: 1, ruleName: 'uniquenessViolation', context: { nullsEqual: true, duplicateOfRow: 0 } },
            ],
        },
    });

    V({
        name: 'uniqueness nullsEqual false — effectively-null cells excluded',
        schema: {
            meta: META, resultConfig: RC,
            nullHandling: { nullEquivalents: ['NA'] },
            columns: {
                a: { nullable: true, unique: { enabled: true, nullsEqual: false }, type: { name: 'string' } },
            },
        },
        table: { headers: ['a'], rows: [['NA'], [null], ['x']] },
        expect: {
            valid: true,
            summary: { bySeverity: { error: 0, warning: 0 } },
            cellRegister: [],
        },
    });

    V({
        name: 'compositeKeyViolation — duplicate tuples via interpreted values, entries per key column',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { type: { name: 'int' } }, b: { type: { name: 'string' } } },
            compositeKeys: [{ columns: ['a', 'b'], nullsAllowed: false, severity: 'error' }],
        },
        table: { headers: ['a', 'b'], rows: [['1', 'x'], ['01', 'x'], ['2', 'y']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 2 },                       // 2 violations…
                byColumn: { a: { error: 2 }, b: { error: 2 } }, // …4 entries
                details: [{
                    ruleName: 'compositeKeyViolation', fieldName: 'a', count: 2,
                    message: 'Duplicate key (a, b)',
                }, {
                    ruleName: 'compositeKeyViolation', fieldName: 'b', count: 2,
                }],
            },
            cellRegister: [
                { row: 0, field: 'a', context: { keyColumns: ['a', 'b'], nullsAllowed: false, duplicateOfRow: null } },
                { row: 0, field: 'b', context: { duplicateOfRow: null } },
                { row: 1, field: 'a', context: { duplicateOfRow: 0 } },
                { row: 1, field: 'b', context: { duplicateOfRow: 0 } },
            ],
        },
    });

    V({
        name: 'compositeKeyNullViolation — nullsAllowed false, one entry per null key cell',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            nullHandling: { nullEquivalents: [''] },
            columns: {
                a: { type: { name: 'int' } },
                b: { nullable: true, type: { name: 'string' } },
            },
            compositeKeys: [{ columns: ['a', 'b'], nullsAllowed: false }],
        },
        table: { headers: ['a', 'b'], rows: [['1', ''], ['2', 'y']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                byPhase: { columnAggregateChecks: 1 },
                details: [{
                    ruleName: 'compositeKeyNullViolation', fieldName: 'b', count: 1,
                    context: { keyColumns: ['a', 'b'], nullColumn: 'b' },
                    message: 'Null in key column (a, b)',
                }],
            },
            cellRegister: [{ row: 0, field: 'b', ruleName: 'compositeKeyNullViolation', value: '' }],
        },
    });

    V({
        name: 'compositeKey nullsAllowed true — tuples with nulls excluded (SQL semantics)',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: { type: { name: 'int' } },
                b: { nullable: true, type: { name: 'string' } },
            },
            compositeKeys: [{ columns: ['a', 'b'], nullsAllowed: true }],
        },
        table: { headers: ['a', 'b'], rows: [['1', null], ['1', null]] },
        expect: {
            valid: true,
            summary: { bySeverity: { error: 0, warning: 0 } },
            cellRegister: [],
        },
    });
})();
