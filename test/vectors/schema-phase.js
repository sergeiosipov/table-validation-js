/* Golden vectors — Phase 1 schema self-validation + Phase 2 irrelevant-setting infos. */
'use strict';
(function () {
    const V = (v) => window.__VECTORS__.push(Object.assign({ suite: 'schema phase' }, v));

    V({
        name: 'schemaValidationError — missing meta halts with {path, expected, actual}',
        schema: {
            resultConfig: { collectCellRegister: true },
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [['x']] },
        expect: {
            valid: false, validWithWarnings: false, truncated: false, truncationReason: null,
            summary: {
                rowsChecked: 0, columnsChecked: 0, columnMatching: 'byName',
                bySeverity: { error: 1, warning: 0 },
                byPhase: { schemaValidation: 1, cellValidation: 0 },
                byColumn: { _schema: { error: 1 } },
                details: [{
                    severity: 'error', phase: 'schemaValidation', ruleName: 'schemaValidationError',
                    fieldName: '_schema', count: 1, firstOccurrenceRow: null,
                    context: { path: 'meta', expected: 'object' },
                }],
            },
            cellRegister: [{ row: null, field: '_schema', severity: 'error', ruleName: 'schemaValidationError' }],
        },
    });

    V({
        name: 'schemaValidationError — Range min > max (rule 13)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: {
                a: { type: { name: 'int', value: { min: 5, max: 1, minInclusive: true, maxInclusive: true } } },
            },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{ ruleName: 'schemaValidationError', context: { path: 'columns.a.type.value' } }],
            },
        },
    });

    V({
        name: 'schemaValidationError — comparison references unknown column (rule 28)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'int' } }, b: { type: { name: 'int' } } },
            customRowChecks: [{ name: 'c1', type: 'comparison', fieldA: 'a', fieldB: 'nope', op: '<' }],
        },
        table: { headers: ['a', 'b'], rows: [] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'customRowChecks[0].fieldB', expected: 'existing column name', actual: 'nope' },
                }],
            },
        },
    });

    V({
        name: 'schemaValidationError — regexFlags "g" is forbidden (rule 24)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'string', regex: 'x', regexFlags: 'g' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{ ruleName: 'schemaValidationError', context: { path: 'columns.a.type.regexFlags' } }],
            },
        },
    });

    V({
        name: 'schemaValidationError — byPosition requires trailing optional suffix (rule 42)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            structure: { columnMatching: 'byPosition' },
            columns: {
                a: { required: false, type: { name: 'string' } },
                b: { required: true, type: { name: 'string' } },
            },
        },
        table: { headers: null, rows: [] },
        expect: {
            valid: false,
            summary: {
                columnMatching: 'byPosition',
                bySeverity: { error: 1 },
                details: [{ ruleName: 'schemaValidationError', context: { path: 'columns.b.required' } }],
            },
        },
    });

    V({
        name: 'schemaValidationError — bool true/false lists overlap after matchStrategy (rule 43)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'bool', trueValues: ['YES'], falseValues: ['yes'] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'columns.a.type.trueValues', actual: 'yes' },
                }],
            },
        },
    });

    V({
        name: 'schemaValidationError — datetime format without time tokens (rule 21)',
        needsLuxon: true,
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'datetime', formats: ['yyyy-MM-dd'] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{ ruleName: 'schemaValidationError', context: { path: 'columns.a.type.formats[0]' } }],
            },
        },
    });

    V({
        name: 'schemaValidationError — comparison class mismatch int vs string (rule 34)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'int' } }, b: { type: { name: 'string' } } },
            customRowChecks: [{ name: 'c1', type: 'comparison', fieldA: 'a', fieldB: 'b', op: '<' }],
        },
        table: { headers: ['a', 'b'], rows: [] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{ ruleName: 'schemaValidationError', context: { path: 'customRowChecks[0].fieldA' } }],
            },
        },
    });

    V({
        name: 'irrelevantSetting — infos for byPosition name machinery and strict-mode formats',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            resultConfig: { collectCellRegister: true },
            structure: { columnMatching: 'byPosition', enforceColumnOrder: false },
            columns: {
                a: { type: { name: 'int', formats: [{ decimalSeparator: null, groupingSeparators: [' '] }] } },
            },
        },
        table: { headers: null, rows: [[1]] },
        expect: {
            valid: true, validWithWarnings: true,
            summary: {
                rowsChecked: 1, columnsChecked: 1, columnMatching: 'byPosition',
                bySeverity: { error: 0, warning: 2 },
                byPhase: { schemaResolution: 2, cellValidation: 0 },
                byColumn: { _schema: { warning: 2 } },
                details: [{
                    severity: 'warning', phase: 'schemaResolution', ruleName: 'irrelevantSetting',
                    fieldName: '_schema', count: 2,
                    context: { setting: 'structure.enforceColumnOrder' },
                }],
            },
            cellRegister: [
                { field: '_schema', severity: 'warning', ruleName: 'irrelevantSetting' },
                { field: '_schema', severity: 'warning', ruleName: 'irrelevantSetting' },
            ],
        },
    });

    // ---------------- v1.3.0: rules 12 (negativeStyle/pattern) + 58 (twoDigitYearPivot) ----------------

    V({
        name: 'rule 12 (1.3.0): unknown negativeStyle halts',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' },
            columns: { a: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [], negativeStyle: 'suffix' }] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: { valid: false, aborted: true, abortReason: 'schemaInvalid' },
    });

    V({
        name: 'rule 12 (1.3.0): parentheses style forbids "(" among separators',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' },
            columns: { a: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: ['('], negativeStyle: 'parentheses' }] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: { valid: false, aborted: true, abortReason: 'schemaInvalid' },
    });

    V({
        name: 'rule 12 (1.3.0): pattern with undeclared characters halts',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' },
            columns: { a: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [], pattern: '#,##0.00' }] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: { valid: false, aborted: true, abortReason: 'schemaInvalid' },   // "," not declared
    });

    V({
        name: 'rule 12 (1.3.0): structurally invalid pattern (unequal grouping segments) halts',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' },
            columns: { a: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [','], pattern: '#,##00,0.0' }] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: { valid: false, aborted: true, abortReason: 'schemaInvalid' },
    });

    V({
        name: 'rule 58 (1.3.0): twoDigitYearPivot out of range halts (table and column levels)',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' },
            evaluation: { strictType: true, timezone: 'utc', twoDigitYearPivot: 999 },
            columns: { d: { type: { name: 'date', formats: ['dd/MM/yy'] } } },
        },
        table: { headers: ['d'], rows: [] },
        expect: { valid: false, aborted: true, abortReason: 'schemaInvalid' },
    });

    // ---------------- v1.3.1: rules 21 (SSSSSS is a time token) + 53 (byRule keys) ----------------

    V({
        name: 'rule 21 (1.3.1): date formats reject SSSSSS',
        needsLuxon: true,
        schema: {
            meta: { schemaVersion: '1.3.1', name: 't' },
            columns: { d: { type: { name: 'date', formats: ['yyyy-MM-dd.SSSSSS'] } } },
        },
        table: { headers: ['d'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                bySeverity: { error: 1 },
                details: [{ ruleName: 'schemaValidationError', context: { path: 'columns.d.type.formats[0]' } }],
            },
        },
    });

    V({
        name: 'rule 21 (1.3.1): SSSSSS stays legal on datetime formats',
        needsLuxon: true,
        schema: {
            meta: { schemaVersion: '1.3.1', name: 't' },
            columns: { d: { type: { name: 'datetime', formats: ['yyyy-MM-dd HH:mm:ss.SSSSSS'] } } },
        },
        table: { headers: ['d'], rows: [] },
        expect: { valid: true, aborted: false },
    });

    V({
        name: 'rule 53 (1.3.1): severity.byRule keys must name emittable rules',
        schema: {
            meta: { schemaVersion: '1.3.1', name: 't' },
            columns: { a: { severity: { default: 'error', byRule: { notARealRule: 'warning' } }, type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{ ruleName: 'schemaValidationError', context: { path: 'columns.a.severity.byRule.notARealRule' } }],
            },
        },
    });

    V({
        name: 'rule 53 (1.3.1): structural rule names are not column-emittable',
        schema: {
            meta: { schemaVersion: '1.3.1', name: 't' },
            columns: { a: { severity: { default: 'error', byRule: { rowCountBreach: 'warning' } }, type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{ ruleName: 'schemaValidationError', context: { path: 'columns.a.severity.byRule.rowCountBreach' } }],
            },
        },
    });

    V({
        name: 'rule 53 (1.3.1): the §5.6 fixed list is accepted',
        schema: {
            meta: { schemaVersion: '1.3.1', name: 't' },
            columns: { a: { severity: { default: 'error', byRule: { rangeBreach: 'warning' } }, type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: { valid: true, aborted: false },
    });

})();
