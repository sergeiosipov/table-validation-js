/* Golden vectors — Phase 6 cell-level validation. */
'use strict';
(function () {
    const V = (v) => window.__VECTORS__.push(Object.assign({ suite: 'cell validation' }, v));
    const META = { schemaVersion: '1.0.0', name: 't' };
    const RC = { collectCellRegister: true };

    V({
        name: 'nullabilityViolation — native null and null-equivalent string',
        schema: {
            meta: META, resultConfig: RC,
            nullHandling: { nullEquivalents: ['NA'] },
            columns: { a: { nullable: false, type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [['NA'], [null], ['ok']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 2 },
                byPhase: { cellValidation: 2 },
                byColumn: { a: { error: 2 } },
                details: [{
                    ruleName: 'nullabilityViolation', fieldName: 'a', count: 2, firstOccurrenceRow: 0,
                    topSampleValues: [{ value: 'NA', frequency: 1 }, { value: 'null', frequency: 1 }],
                    topSampleRows: [0, 1],
                    message: 'Null value in non-nullable column',
                }],
            },
            cellRegister: [
                { row: 0, field: 'a', ruleName: 'nullabilityViolation', value: 'NA' },
                { row: 1, field: 'a', ruleName: 'nullabilityViolation', value: null },
            ],
        },
    });

    V({
        name: 'typeMismatch — strictType true rejects strings, non-integral, booleans in an int column',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'utc' },
            columns: { a: { type: { name: 'int' } } },
        },
        table: { headers: ['a'], rows: [['1'], [1], [1.5], [true]] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 3 },
                details: [{
                    ruleName: 'typeMismatch', fieldName: 'a', count: 3,
                    context: { expectedType: 'int', actualType: 'string' },
                }],
            },
            cellRegister: [
                { row: 0, ruleName: 'typeMismatch', context: { actualType: 'string' }, message: 'Expected int, got string' },
                { row: 2, ruleName: 'typeMismatch', context: { actualType: 'float' } },
                { row: 3, ruleName: 'typeMismatch', context: { actualType: 'bool' } },
            ],
        },
    });

    V({
        name: 'int NumberFormat acceptance — grouping spaces, comma decimal rejected in int context',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: { type: { name: 'int', formats: [{ decimalSeparator: ',', groupingSeparators: [' '] }] } },
            },
        },
        table: { headers: ['a'], rows: [['1 234'], ['12'], ['1 234,5'], ['x']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2 } },
            cellRegister: [
                { row: 2, ruleName: 'typeMismatch', value: '1 234,5' },
                { row: 3, ruleName: 'typeMismatch', value: 'x' },
            ],
        },
    });

    V({
        name: 'rangeBreach value — int range on interpreted values',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: { type: { name: 'int', value: { min: 0, max: 10, minInclusive: true, maxInclusive: true } } },
            },
        },
        table: { headers: ['a'], rows: [['5'], ['11'], ['-1']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 2 },
                details: [{
                    ruleName: 'rangeBreach', fieldName: 'a', count: 2,
                    context: { constraint: 'value', min: 0, max: 10, minInclusive: true, maxInclusive: true },
                    message: 'value out of range 0–10',
                }],
            },
            cellRegister: [
                { row: 1, ruleName: 'rangeBreach', value: '11' },
                { row: 2, ruleName: 'rangeBreach', value: '-1' },
            ],
        },
    });

    V({
        name: 'rangeBreach length — counted in code points (astral chars count once)',
        schema: {
            meta: META, resultConfig: RC,
            columns: {
                a: {
                    type: {
                        name: 'string',
                        length: { min: 1, max: 2, minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['a'], rows: [['😀😀'], ['abc'], ['']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2 } },
            cellRegister: [
                { row: 1, ruleName: 'rangeBreach', context: { constraint: 'length' } },
                { row: 2, ruleName: 'rangeBreach', context: { constraint: 'length' } },
            ],
        },
    });

    V({
        name: 'rangeBreach precision — measured on the lexical form as given',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: {
                    type: {
                        name: 'float',
                        precision: { min: 0, max: 2, minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['a'], rows: [['1.50'], ['1.500'], [1.5]] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1 } },
            cellRegister: [
                { row: 1, ruleName: 'rangeBreach', context: { constraint: 'precision' }, value: '1.500' },
            ],
        },
    });

    V({
        name: 'regexMismatch — compiled once, whole-value anchored by the pattern',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { type: { name: 'string', regex: '^[A-Z]{2}\\d{2}$' } } },
        },
        table: { headers: ['a'], rows: [['AB12'], ['ab12']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'regexMismatch', fieldName: 'a',
                    context: { regex: '^[A-Z]{2}\\d{2}$', regexFlags: null },
                    message: 'Value does not match pattern /^[A-Z]{2}\\d{2}$/',
                }],
            },
            cellRegister: [{ row: 1, ruleName: 'regexMismatch', value: 'ab12' }],
        },
    });

    V({
        name: 'categoryMismatch — non-strict categorical with matchStrategy',
        schema: {
            meta: META, resultConfig: RC,
            columns: {
                a: { type: { name: 'categorical', allowedValues: ['red', 'green'] } },
            },
        },
        table: { headers: ['a'], rows: [['RED '], ['blue']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 1 },
                details: [{
                    ruleName: 'categoryMismatch', fieldName: 'a',
                    context: { allowedValues: ['red', 'green'], typeStrict: false },
                    message: 'Value not in the allowed set',
                }],
            },
            cellRegister: [{ row: 1, ruleName: 'categoryMismatch', value: 'blue' }],
        },
    });

    V({
        name: 'bool acceptance — value lists via matchStrategy; unmatched string is typeMismatch',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { type: { name: 'bool' } } },
        },
        table: { headers: ['a'], rows: [['YES'], ['nope'], [true]] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1 } },
            cellRegister: [{
                row: 1, ruleName: 'typeMismatch', value: 'nope',
                context: { expectedType: 'bool', actualType: 'string' },
            }],
        },
    });

    V({
        name: 'non-scalar cells — typeMismatch with actualType object/array',
        schema: { meta: META, resultConfig: RC, columns: { a: { type: { name: 'string' } } } },
        table: { headers: ['a'], rows: [[[1, 2]], [{ x: 1 }]] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2 } },
            cellRegister: [
                { row: 0, ruleName: 'typeMismatch', context: { actualType: 'array' } },
                { row: 1, ruleName: 'typeMismatch', context: { actualType: 'object' } },
            ],
        },
    });

    V({
        name: 'string non-strict — native scalars accepted via canonical conversion, constraints on interpretation',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: {
                    type: {
                        name: 'string',
                        length: { min: 2, max: 2, minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['a'], rows: [[12], [5]] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1 } },
            cellRegister: [{ row: 1, ruleName: 'rangeBreach', value: 5, context: { constraint: 'length' } }],
        },
    });
})();
