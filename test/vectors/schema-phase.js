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
})();
