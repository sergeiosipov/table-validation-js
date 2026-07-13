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

    // ---------------- v1.3.0: NumberFormat negativeStyle + pattern ----------------

    V({
        name: 'negativeStyle parentheses (1.3.0): "(1,234.50)" reads as -1234.50; leading minus rejects',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                amt: {
                    type: {
                        name: 'float',
                        formats: [{ decimalSeparator: '.', groupingSeparators: [','], negativeStyle: 'parentheses' }],
                        value: { min: -1234.5, max: 100, minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['amt'], rows: [['(1,234.50)'], ['12.00'], ['-1,234.50']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 2, ruleName: 'typeMismatch' }],   // accounting notation only (leading
            // minus + grouping: the format rejects the sign, the direct-parse fallback the comma)
        },
    });

    V({
        name: 'negativeStyle trailingMinus (1.3.0): SAP "1234.50-" reads as -1234.50; precision stays lexical',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                amt: {
                    type: {
                        name: 'float',
                        formats: [{ decimalSeparator: '.', groupingSeparators: [], negativeStyle: 'trailingMinus' }],
                        value: { min: -2000, max: 0, minInclusive: true, maxInclusive: false },
                        precision: { min: 2, max: 2, minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['amt'], rows: [['1234.50-']] },
        expect: { valid: true, summary: { bySeverity: { error: 0, warning: 0 } } },
    });

    V({
        name: 'mixed sign notations coexist via the formats array (1.3.0): leadingSign + parentheses',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                amt: {
                    type: {
                        name: 'float',
                        formats: [
                            { decimalSeparator: '.', groupingSeparators: [','] },
                            { decimalSeparator: '.', groupingSeparators: [','], negativeStyle: 'parentheses' },
                        ],
                    },
                },
            },
        },
        table: { headers: ['amt'], rows: [['-12.00'], ['(3.50)'], ['7.25']] },
        expect: { valid: true, summary: { bySeverity: { error: 0, warning: 0 } } },
    });

    V({
        name: 'pattern (1.3.0): "#,##0.00" enforces grouping positions and two decimals (CSVW hard constraint)',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                amt: {
                    type: {
                        name: 'float',
                        formats: [{ decimalSeparator: '.', groupingSeparators: [','], pattern: '#,##0.00' }],
                    },
                },
            },
        },
        table: { headers: ['amt'], rows: [['1,234.50'], ['234.50'], ['1234.50'], ['1,234.5']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2, warning: 0 } },
            cellRegister: [
                { row: 2, ruleName: 'typeMismatch' },   // pattern suppresses the direct-parse fallback
                { row: 3, ruleName: 'typeMismatch' },
            ],
        },
    });

    V({
        name: 'pattern (1.3.0): "0.0000" — exactly four decimals; zero forms unbroken elsewhere',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [], pattern: '0.0000' }] } },
                b: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [','] }] } },
            },
        },
        table: { headers: ['a', 'b'], rows: [['6.1600', '0'], ['6.16', '-0']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 1, field: 'a', ruleName: 'typeMismatch' }],
        },
    });

    // ---------------- v1.3.1: pattern × allowBareDecimal, pattern × negativeStyle ----------------

    V({
        name: 'pattern (1.3.1): grouped all-# integer part admits bare decimals under allowBareDecimal',
        schema: {
            meta: { schemaVersion: '1.3.1', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: {
                    type: {
                        name: 'float',
                        formats: [{ decimalSeparator: '.', groupingSeparators: [','], allowBareDecimal: true, pattern: '#,###.00' }],
                    },
                },
            },
        },
        table: { headers: ['a'], rows: [['.85'], ['1,234.50'], ['234.50'], ['12.5']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 3, ruleName: 'typeMismatch' }],   // pattern demands exactly 2 decimals;
            // '.85' passes since 1.3.1 (all-# integer part → integer digits optional)
        },
    });

    V({
        name: 'pattern (1.3.1): without allowBareDecimal the base grammar still gates ".85"',
        schema: {
            meta: { schemaVersion: '1.3.1', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: {
                    type: {
                        name: 'float',
                        formats: [{ decimalSeparator: '.', groupingSeparators: [','], pattern: '#,###.00' }],
                    },
                },
            },
        },
        table: { headers: ['a'], rows: [['.85']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 0, ruleName: 'typeMismatch' }],
        },
    });

    V({
        name: 'pattern applies to the unsigned body under leadingSign (1.3.1)',
        schema: {
            meta: { schemaVersion: '1.3.1', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                amt: {
                    type: {
                        name: 'float',
                        formats: [{ decimalSeparator: '.', groupingSeparators: [','], pattern: '#,##0.00' }],
                    },
                },
            },
        },
        table: { headers: ['amt'], rows: [['-1,234.50'], ['+1,234.50'], ['1,234.50']] },
        expect: { valid: true, summary: { bySeverity: { error: 0, warning: 0 } } },   // pre-1.3.1 the
        // leading sign broke the pattern match → typeMismatch
    });

    V({
        name: 'pattern × parentheses (1.3.1): the style owns the sign; a leading minus is no decoration',
        schema: {
            meta: { schemaVersion: '1.3.1', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                amt: {
                    type: {
                        name: 'float',
                        formats: [{ decimalSeparator: '.', groupingSeparators: [','], negativeStyle: 'parentheses', pattern: '#,##0.00' }],
                    },
                },
            },
        },
        table: { headers: ['amt'], rows: [['(1,234.50)'], ['-1,234.50']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 1, ruleName: 'typeMismatch' }],
        },
    });

})();
