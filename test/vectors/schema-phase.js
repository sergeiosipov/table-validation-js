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

    // ---------------- v1.4.0 P1: Core §10 rule negatives (B001–B021) ----------------

    V({
        name: 'rule 4: evaluation.timezone syntactically string but not a valid IANA zone',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            evaluation: { timezone: 'Fake/Zone' },
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'evaluation.timezone', expected: '"utc", "local", or a valid IANA zone name', actual: 'Fake/Zone' },
                }],
            },
        },
    });

    V({
        name: 'rule 8: compositeKeys must be an array',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            compositeKeys: 'nope',
            columns: { a: { type: { name: 'string' } }, b: { type: { name: 'string' } } },
        },
        table: { headers: ['a', 'b'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{ ruleName: 'schemaValidationError', context: { path: 'compositeKeys', expected: 'array', actual: 'nope' } }],
            },
        },
    });

    V({
        name: 'rule 8: customRowChecks must be an array',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            customRowChecks: 'nope',
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{ ruleName: 'schemaValidationError', context: { path: 'customRowChecks', expected: 'array', actual: 'nope' } }],
            },
        },
    });

    V({
        name: 'rule 8: customTableChecks must be an array',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            customTableChecks: 'nope',
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{ ruleName: 'schemaValidationError', context: { path: 'customTableChecks', expected: 'array', actual: 'nope' } }],
            },
        },
    });

    V({
        name: 'rule 9: resultConfig must be an object',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            resultConfig: 'nope',
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{ ruleName: 'schemaValidationError', context: { path: 'resultConfig', expected: 'object', actual: 'nope' } }],
            },
        },
    });

    V({
        name: 'rule 11: Range object missing a required key (maxInclusive)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'int', value: { min: 1, max: 5, minInclusive: true } } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'columns.a.type.value.maxInclusive', expected: 'Range key present (min, max, minInclusive, maxInclusive)' },
                }],
            },
        },
    });

    V({
        name: 'rule 14: count range bound must be non-negative integer or null (negative)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            structure: { rowCount: { min: -1, max: null, minInclusive: true, maxInclusive: true } },
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'structure.rowCount.min', expected: 'non-negative integer or null', actual: -1 },
                }],
            },
        },
    });

    V({
        name: 'rule 14: count range bound must be non-negative integer or null (non-integer)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            structure: { rowCount: { min: 0.5, max: null, minInclusive: true, maxInclusive: true } },
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'structure.rowCount.min', expected: 'non-negative integer or null', actual: 0.5 },
                }],
            },
        },
    });

    V({
        name: 'rule 15: numeric (float) value range bound must be number or null',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'float', value: { min: 'x', max: 5, minInclusive: true, maxInclusive: true } } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'columns.a.type.value.min', expected: 'number or null', actual: 'x' },
                }],
            },
        },
    });

    V({
        name: 'rule 19: disallowed extra key for the declared type (bool key on a string type)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'string', trueValues: ['x'] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'columns.a.type.trueValues', expected: 'no "trueValues" key on type "string"' },
                }],
            },
        },
    });

    V({
        name: 'rule 27: compositeKeys[].columns entry must exist among columns',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'string' } }, b: { type: { name: 'string' } } },
            compositeKeys: [{ columns: ['a', 'nope'] }],
        },
        table: { headers: ['a', 'b'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'compositeKeys[0].columns', expected: 'existing column name', actual: 'nope' },
                }],
            },
        },
    });

    V({
        name: 'rule 29: customTableChecks field reference must exist (well-typed but unknown column)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'int' } } },
            customTableChecks: [{ name: 'c1', type: 'monotonic', field: 'nope', direction: 'increasing' }],
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'customTableChecks[0].field', expected: 'existing column name', actual: 'nope' },
                }],
            },
        },
    });

    V({
        name: 'rule 32: nonNullCount/cooccurrence fields array must have length >= 2',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'int' } }, b: { type: { name: 'int' } } },
            customRowChecks: [{ name: 'c1', type: 'nonNullCount', fields: ['a'], expected: 1 }],
        },
        table: { headers: ['a', 'b'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'customRowChecks[0].fields', expected: 'field array with length >= 2', actual: ['a'] },
                }],
            },
        },
    });

    V({
        name: 'rule 33: nonNullCount expected must be within [0, fields.length]',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'int' } }, b: { type: { name: 'int' } } },
            customRowChecks: [{ name: 'c1', type: 'nonNullCount', fields: ['a', 'b'], expected: 5 }],
        },
        table: { headers: ['a', 'b'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'customRowChecks[0].expected', expected: 'integer between 0 and 2', actual: 5 },
                }],
            },
        },
    });

    V({
        name: 'rule 35: conditionalRequired if.field must not be a skip column',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'skip' } }, b: { type: { name: 'int' } } },
            customRowChecks: [{ name: 'c1', type: 'conditionalRequired', if: { field: 'a', op: '==', value: 1 }, then: { field: 'b', nonNull: true } }],
        },
        table: { headers: ['a', 'b'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'customRowChecks[0].if.field', expected: 'non-skip column', actual: 'a' },
                }],
            },
        },
    });

    V({
        name: 'rule 35: conditionalRequired if.value must be type-compatible with if.field\'s class (bool)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'bool' } }, b: { type: { name: 'int' } } },
            customRowChecks: [{ name: 'c1', type: 'conditionalRequired', if: { field: 'a', op: '==', value: 'notabool' }, then: { field: 'b', nonNull: true } }],
        },
        table: { headers: ['a', 'b'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'customRowChecks[0].if.value', expected: 'boolean literal with == or != operator', actual: 'notabool' },
                }],
            },
        },
    });

    V({
        name: 'rule 38: sequenceNoGaps referenced column must be int',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'string' } } },
            customTableChecks: [{ name: 'c1', type: 'sequenceNoGaps', field: 'a' }],
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'customTableChecks[0].field', expected: 'int column', actual: 'string' },
                }],
            },
        },
    });

    V({
        name: 'rule 39: sumEquals referenced column must be int/float',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'string' } }, b: { type: { name: 'int' } } },
            customTableChecks: [{ name: 'c1', type: 'sumEquals', fields: ['a'], expectedField: 'b', expectedFieldRow: 'first' }],
        },
        table: { headers: ['a', 'b'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'customTableChecks[0].fields[0]', expected: 'int or float column', actual: 'string' },
                }],
            },
        },
    });

    V({
        name: 'rule 40: monotonic referenced column type must be in {int,float,string,datetime,date,time}',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'bool' } } },
            customTableChecks: [{ name: 'c1', type: 'monotonic', field: 'a', direction: 'increasing' }],
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: {
                        path: 'customTableChecks[0].field',
                        expected: 'column of type int, float, string, datetime, date, or time',
                        actual: 'bool',
                    },
                }],
            },
        },
    });

    V({
        name: 'rule 41: byName column names must not collide after fieldNameMatching normalization',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            structure: { fieldNameMatching: { stripSpaces: true } },
            columns: { 'Field A': { type: { name: 'string' } }, fielda: { type: { name: 'string' } } },
        },
        table: { headers: ['Field A', 'fielda'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'columns.fielda', expected: 'column names distinct after fieldNameMatching normalization', actual: 'collides with "Field A"' },
                }],
            },
        },
    });

    V({
        name: 'rule 45: allowMissingColumns:true + column required:true -> valid config, column wins when absent',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            structure: { allowMissingColumns: true },
            columns: { a: { required: true, type: { name: 'string' } }, b: { type: { name: 'string' } } },
        },
        table: { headers: ['b'], rows: [] },
        expect: {
            valid: false, aborted: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    severity: 'error', phase: 'structuralColumnChecks', ruleName: 'requiredColumnMissing',
                    fieldName: 'a', context: { expectedPosition: null },
                }],
            },
        },
    });

    V({
        name: 'rule 46: composite-key column groups must not be exact duplicates (reordered)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'string' } }, b: { type: { name: 'string' } } },
            compositeKeys: [{ columns: ['a', 'b'] }, { columns: ['b', 'a'] }],
        },
        table: { headers: ['a', 'b'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'compositeKeys[1].columns', expected: 'no duplicate composite key definitions', actual: ['b', 'a'] },
                }],
            },
        },
    });

    V({
        name: 'rule 47: regex pattern must test-compile with declared flags',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'string', regex: '(' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'columns.a.type.regex', expected: 'valid ECMAScript regex pattern', actual: '(' },
                }],
            },
        },
    });

    V({
        name: 'rule 48: temporal format string well-typed but rejected by the temporal engine',
        needsLuxon: true,
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { d: { type: { name: 'date', formats: ['yyyy-QQ-dd'] } } },
        },
        table: { headers: ['d'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'columns.d.type.formats[0]', expected: 'valid temporal format (Core Spec §13.3 tokens)', actual: 'yyyy-QQ-dd' },
                }],
            },
        },
    });

    V({
        name: 'rule 52: int.value range bound must be integral (non-integral bound)',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'int', value: { min: 1.5, max: 5, minInclusive: true, maxInclusive: true } } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'columns.a.type.value.min', expected: 'integral number in the safe range or null', actual: 1.5 },
                }],
            },
        },
    });

    V({
        name: 'rule 52: int.value range bound must be within the safe-integer range',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            columns: { a: { type: { name: 'int', value: { min: Number.MAX_SAFE_INTEGER + 10, max: null, minInclusive: true, maxInclusive: true } } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'columns.a.type.value.min', expected: 'integral number in the safe range or null', actual: Number.MAX_SAFE_INTEGER + 10 },
                }],
            },
        },
    });

    // ---------------- v1.4.0 P4: Settings/overrides/type blocks (B085, B090) ----------------

    V({
        name: 'rule 56: resultConfig.stopPolicy must be "never" or "firstError"',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' },
            resultConfig: { stopPolicy: 'sometimes' },
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'resultConfig.stopPolicy', expected: '"never" or "firstError"', actual: 'sometimes' },
                }],
            },
        },
    });

    V({
        name: 'irrelevantSetting (B090): column strictType override is irrelevant for a temporal column',
        needsLuxon: true,
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' }, resultConfig: { collectCellRegister: true },
            columns: { d: { evaluation: { strictType: true }, type: { name: 'date', formats: ['yyyy-MM-dd'] } } },
        },
        table: { headers: ['d'], rows: [] },
        expect: {
            valid: true, validWithWarnings: true,
            summary: {
                bySeverity: { error: 0, warning: 1 },
                details: [{
                    severity: 'warning', ruleName: 'irrelevantSetting',
                    context: { setting: 'columns.d.evaluation.strictType', reason: 'strictType is irrelevant for date columns' },
                }],
            },
        },
    });

    V({
        name: 'irrelevantSetting (B090): column twoDigitYearPivot override is irrelevant on a non-temporal column',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' }, resultConfig: { collectCellRegister: true },
            columns: { a: { evaluation: { twoDigitYearPivot: 1970 }, type: { name: 'int' } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: true, validWithWarnings: true,
            summary: {
                bySeverity: { error: 0, warning: 1 },
                details: [{
                    severity: 'warning', ruleName: 'irrelevantSetting',
                    context: { setting: 'columns.a.evaluation.twoDigitYearPivot', reason: 'twoDigitYearPivot is irrelevant for int columns' },
                }],
            },
        },
    });

    V({
        name: 'irrelevantSetting (B090): column twoDigitYearPivot override is irrelevant when no format on that column carries yy',
        needsLuxon: true,
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' }, resultConfig: { collectCellRegister: true },
            columns: { d: { evaluation: { twoDigitYearPivot: 1970 }, type: { name: 'date', formats: ['yyyy-MM-dd'] } } },
        },
        table: { headers: ['d'], rows: [] },
        expect: {
            valid: true, validWithWarnings: true,
            summary: {
                bySeverity: { error: 0, warning: 1 },
                details: [{
                    severity: 'warning', ruleName: 'irrelevantSetting',
                    context: { setting: 'columns.d.evaluation.twoDigitYearPivot', reason: 'no format of this column contains yy, so the pivot is unused' },
                }],
            },
        },
    });

    V({
        name: 'irrelevantSetting (B090): table-level twoDigitYearPivot is irrelevant when no temporal column anywhere carries yy',
        needsLuxon: true,
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' }, resultConfig: { collectCellRegister: true },
            evaluation: { twoDigitYearPivot: 1970 },
            columns: { d: { type: { name: 'date', formats: ['yyyy-MM-dd'] } } },
        },
        table: { headers: ['d'], rows: [] },
        expect: {
            valid: true, validWithWarnings: true,
            summary: {
                bySeverity: { error: 0, warning: 1 },
                details: [{
                    severity: 'warning', ruleName: 'irrelevantSetting',
                    context: { setting: 'evaluation.twoDigitYearPivot', reason: 'no format of any temporal column contains yy, so the pivot is unused' },
                }],
            },
        },
    });

    // ---------------- v1.4.0 P5/sweep-up: rule 12 pattern sub-clauses (B094) ----------------
    // abd:true + null decimalSeparator (the 6th listed sub-clause) is already covered by
    // test/vectors/infer.js:388-390 ("allowBareDecimal: true requires a non-null decimalSeparator").

    V({
        name: 'rule 12 (1.4.0): pattern #/0 ordering — 0 before # in the integer part halts',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' },
            columns: { a: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [], pattern: '0#.00' }] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: {
                        path: 'columns.a.type.formats[0].pattern',
                        expected: 'a structurally valid §3.5 pattern (segment lengths, #/0 ordering, decimal tail)',
                        actual: '0#.00',
                    },
                }],
            },
        },
    });

    V({
        name: 'rule 12 (1.4.0): pattern decimal digit-tail — decimal separator with an empty fraction halts',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' },
            columns: { a: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [], pattern: '0.' }] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: {
                        path: 'columns.a.type.formats[0].pattern',
                        expected: 'a structurally valid §3.5 pattern (segment lengths, #/0 ordering, decimal tail)',
                        actual: '0.',
                    },
                }],
            },
        },
    });

    V({
        name: 'rule 12 (1.4.0): pattern first grouping segment longer than the trailing group size halts',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' },
            columns: { a: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [','], pattern: '000,00.00' }] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: {
                        path: 'columns.a.type.formats[0].pattern',
                        expected: 'a structurally valid §3.5 pattern (segment lengths, #/0 ordering, decimal tail)',
                        actual: '000,00.00',
                    },
                }],
            },
        },
    });

    V({
        name: 'rule 12 (1.4.0): grouping pattern with two declared grouping separators halts',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' },
            columns: { a: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [',', ' '], pattern: '#,##0.00' }] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: {
                        path: 'columns.a.type.formats[0].pattern',
                        expected: 'exactly one declared grouping separator when the pattern uses grouping',
                        actual: '#,##0.00',
                    },
                }],
            },
        },
    });

    V({
        name: 'rule 12 (1.4.0): non-string pattern value halts',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' },
            columns: { a: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [], pattern: 42 }] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: false, aborted: true, abortReason: 'schemaInvalid',
            summary: {
                details: [{
                    ruleName: 'schemaValidationError',
                    context: { path: 'columns.a.type.formats[0].pattern', expected: 'string or null', actual: 42 },
                }],
            },
        },
    });

    V({
        name: 'irrelevantSetting (B090): bool value-lists (trueValues) are irrelevant under effective strictType true',
        schema: {
            meta: { schemaVersion: '1.0.0', name: 't' }, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: true, timezone: 'utc' },
            columns: { a: { type: { name: 'bool', trueValues: ['YES'] } } },
        },
        table: { headers: ['a'], rows: [] },
        expect: {
            valid: true, validWithWarnings: true,
            summary: {
                bySeverity: { error: 0, warning: 1 },
                details: [{
                    severity: 'warning', ruleName: 'irrelevantSetting',
                    context: { setting: 'columns.a.type', reason: 'effective strictType is true, so boolean value lists are unused' },
                }],
            },
        },
    });

})();
