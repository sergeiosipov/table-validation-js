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

    // ---------------- v1.4.0 P4: Settings/overrides/type blocks (B083, B084, B085, B086, B088, B089, B091, B092, B093) ----------------

    V({
        name: 'B083: column evaluation.strictType:false overrides a table strictType:true',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'utc' },
            columns: { a: { evaluation: { strictType: false }, type: { name: 'int' } } },
        },
        table: { headers: ['a'], rows: [['5']] },
        expect: { valid: true, summary: { bySeverity: { error: 0, warning: 0 } } },
    });

    V({
        name: 'B083: column evaluation.strictType:true overrides a table strictType:false',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { evaluation: { strictType: true }, type: { name: 'int' } } },
        },
        table: { headers: ['a'], rows: [['5']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 0, ruleName: 'typeMismatch', context: { expectedType: 'int', actualType: 'string' } }],
        },
    });

    V({
        name: 'B083: column evaluation.strictType explicit null inherits the table value (not treated as false)',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'utc' },
            columns: { a: { evaluation: { strictType: null }, type: { name: 'int' } } },
        },
        table: { headers: ['a'], rows: [['5']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 0, ruleName: 'typeMismatch', context: { expectedType: 'int', actualType: 'string' } }],
        },
    });

    V({
        name: 'B084: column nullHandling.nullEquivalents overrides the table list per column; a non-overridden column keeps inheriting it',
        schema: {
            meta: META, resultConfig: RC,
            nullHandling: { nullEquivalents: ['NA'] },
            columns: {
                a: { nullable: false, nullHandling: { nullEquivalents: ['N/A'] }, type: { name: 'string' } },
                b: { nullable: false, type: { name: 'string' } },
            },
        },
        table: { headers: ['a', 'b'], rows: [['NA', 'NA'], ['N/A', 'N/A']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 2, warning: 0 },
                byColumn: { a: { error: 1 }, b: { error: 1 } },
            },
            cellRegister: [
                { row: 1, field: 'a', ruleName: 'nullabilityViolation', value: 'N/A' },
                { row: 0, field: 'b', ruleName: 'nullabilityViolation', value: 'NA' },
            ],
        },
    });

    V({
        name: 'B085: resultConfig.stopPolicy "firstError" aborts on the first error violation, later rows never checked',
        schema: {
            meta: META,
            resultConfig: { stopPolicy: 'firstError' },
            columns: { a: { nullable: false, type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [[null], [null], ['ok']] },
        expect: {
            valid: false, aborted: true, abortReason: 'stopPolicy',
            summary: {
                bySeverity: { error: 1, warning: 0 },
                details: [{ ruleName: 'nullabilityViolation', fieldName: 'a', count: 1, firstOccurrenceRow: 0 }],
            },
        },
    });

    V({
        name: 'B086: resultConfig.collectCellObservations emits the dense per-cell channel (interpreted/effectivelyNull/violation/notChecked)',
        schema: {
            meta: META,
            resultConfig: { collectCellObservations: true, maxErrorsPerColumn: 1 },
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { nullable: true, type: { name: 'int', value: { min: 0, max: 10, minInclusive: true, maxInclusive: true } } } },
        },
        table: { headers: ['a'], rows: [['5'], [null], ['99'], ['5']] },
        expect: {
            valid: false,
            cellObservations: [
                { row: 0, field: 'a', rawValue: '5', interpretedValue: 5, outcome: 'interpreted', worstSeverity: null },
                { row: 1, field: 'a', rawValue: null, interpretedValue: null, outcome: 'effectivelyNull', worstSeverity: null },
                { row: 2, field: 'a', rawValue: '99', interpretedValue: 99, outcome: 'violation', worstSeverity: 'error' },
                { row: 3, field: 'a', rawValue: '5', interpretedValue: null, outcome: 'notChecked', worstSeverity: null },
            ],
        },
    });

    V({
        name: 'B086: default resultConfig.collectCellObservations is false — result.cellObservations stays null',
        schema: { meta: META, columns: { a: { type: { name: 'int' } } } },
        table: { headers: ['a'], rows: [[5]] },
        expect: { valid: true, cellObservations: null },
    });

    V({
        name: 'B088: structure.severities.rowCountBreach:"warning" downgrades an otherwise-error structural breach',
        schema: {
            meta: META,
            structure: {
                rowCount: { min: 5, max: null, minInclusive: true, maxInclusive: true },
                severities: { rowCountBreach: 'warning' },
            },
            columns: { a: { type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [['x'], ['y']] },
        expect: { valid: true, validWithWarnings: true, summary: { bySeverity: { error: 0, warning: 1 } } },
    });

    V({
        // Three distinct offending values with distinct frequencies, and insertion order
        // (nil, NA, null) deliberately != frequency order (NA=3, null=2, nil=1). maxSamples:2
        // forces BOTH caps to bite: topSampleValues truncates 3 distinct -> 2 (nil dropped),
        // topSampleRows truncates 6 offending rows -> 2. The descending-frequency sort is
        // load-bearing: an insertion-order or ascending comparator yields a different array.
        name: 'B089: resultConfig.maxSamples caps topSampleValues (most-frequent first, overflow dropped) and topSampleRows below the violation count',
        schema: {
            meta: META, resultConfig: { maxSamples: 2 },
            nullHandling: { nullEquivalents: ['NA', 'nil'] },
            columns: { a: { nullable: false, type: { name: 'string' } } },
        },
        table: { headers: ['a'], rows: [['nil'], ['NA'], ['NA'], ['NA'], [null], [null], ['ok']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 6, warning: 0 },
                details: [{
                    ruleName: 'nullabilityViolation', fieldName: 'a', count: 6, firstOccurrenceRow: 0,
                    topSampleValues: [{ value: 'NA', frequency: 3 }, { value: 'null', frequency: 2 }],
                    topSampleRows: [0, 1],
                }],
            },
        },
    });

    V({
        name: 'B091: a multi-format column forfeits the direct-parse fallback if ANY format carries a pattern — CONTROL (no pattern anywhere)',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: {
                    type: {
                        name: 'float',
                        formats: [
                            { decimalSeparator: '.', groupingSeparators: [], negativeStyle: 'trailingMinus' },
                            { decimalSeparator: '.', groupingSeparators: [','], negativeStyle: 'trailingMinus' },
                        ],
                    },
                },
            },
        },
        table: { headers: ['a'], rows: [['+12.50']] },
        expect: { valid: true, summary: { bySeverity: { error: 0, warning: 0 } } },
    });

    V({
        name: 'B091: only the SECOND of two formats carries a pattern; the fallback is still forfeited for the WHOLE column',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: {
                    type: {
                        name: 'float',
                        formats: [
                            { decimalSeparator: '.', groupingSeparators: [], negativeStyle: 'trailingMinus' },
                            { decimalSeparator: '.', groupingSeparators: [','], negativeStyle: 'trailingMinus', pattern: '0.00' },
                        ],
                    },
                },
            },
        },
        table: { headers: ['a'], rows: [['+12.50']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 0, ruleName: 'typeMismatch', value: '+12.50' }],
        },
    });

    V({
        name: 'B092: categorical typeStrict:true — JSON-type match with strict equality; matchStrategy applies only to string-typed allowed values',
        schema: {
            meta: META, resultConfig: RC,
            columns: { a: { type: { name: 'categorical', allowedValues: [2, 'A'], typeStrict: true } } },
        },
        table: { headers: ['a'], rows: [[2], ['A'], ['2'], [3]] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2, warning: 0 } },
            cellRegister: [
                { row: 2, ruleName: 'categoryMismatch', value: '2', context: { typeStrict: true } },
                { row: 3, ruleName: 'categoryMismatch', value: 3, context: { typeStrict: true } },
            ],
        },
    });

    V({
        name: 'B093: skip column is type-transparent (object cell passes) but null is still a nullabilityViolation',
        schema: { meta: META, resultConfig: RC, columns: { a: { nullable: false, type: { name: 'skip' } } } },
        table: { headers: ['a'], rows: [[{ x: 1 }], [null]] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 1, ruleName: 'nullabilityViolation', value: null }],
        },
    });

    V({
        name: 'B093: skip column uniqueness is keyed on the original values via duplicateDetection.matchStrategy',
        schema: {
            meta: META, resultConfig: RC,
            structure: { duplicateDetection: { matchStrategy: { caseSensitive: false } } },
            columns: { a: { unique: { enabled: true }, type: { name: 'skip' } } },
        },
        table: { headers: ['a'], rows: [['Foo'], ['foo']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2, warning: 0 } },
            cellRegister: [
                { row: 0, ruleName: 'uniquenessViolation', value: 'Foo' },
                { row: 1, ruleName: 'uniquenessViolation', value: 'foo', context: { duplicateOfRow: 0 } },
            ],
        },
    });

    // ---------------- v1.4.0 P5: §3 primitives edges (B095, B096, B098) ----------------

    V({
        name: 'B095: allowBareDecimal validate()-path positive pin — ".85"/"-.02" interpret to exact value + precision (no pattern)',
        schema: {
            meta: { schemaVersion: '1.2.0', name: 't' },
            resultConfig: { collectCellRegister: true, collectCellObservations: true },
            evaluation: { strictType: false, timezone: 'utc' },
            columns: {
                a: {
                    type: {
                        name: 'float',
                        formats: [{ decimalSeparator: '.', groupingSeparators: [], allowBareDecimal: true }],
                        precision: { min: 2, max: 2, minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['a'], rows: [['.85'], ['-.02']] },
        expect: {
            valid: true,
            cellRegister: [],
            cellObservations: [
                { row: 0, field: 'a', rawValue: '.85', interpretedValue: 0.85, outcome: 'interpreted', worstSeverity: null },
                { row: 1, field: 'a', rawValue: '-.02', interpretedValue: -0.02, outcome: 'interpreted', worstSeverity: null },
            ],
        },
    });

    V({
        name: 'B096: StringMatchStrategy trim collapses internal whitespace runs to a single space before comparison',
        schema: {
            meta: META, resultConfig: RC,
            columns: {
                a: { type: { name: 'categorical', allowedValues: ['red car'], matchStrategy: { caseSensitive: false, trim: true, stripSpaces: false } } },
            },
        },
        // '  red   car  ' and 'red  car' both collapse+trim to 'red car' and match; 'redcar' (no
        // space at all) does NOT match — trim collapses runs, it never removes single spaces.
        table: { headers: ['a'], rows: [['  red   car  '], ['red  car'], ['redcar']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 2, ruleName: 'categoryMismatch', value: 'redcar' }],
        },
    });

    V({
        name: 'B096: StringMatchStrategy trim reduces a whitespace-only cell to "" for comparison purposes',
        schema: {
            meta: META, resultConfig: RC,
            columns: {
                a: { nullable: false, type: { name: 'categorical', allowedValues: [''], matchStrategy: { caseSensitive: false, trim: true, stripSpaces: false } } },
            },
        },
        // trim is comparison-only (§3.2), never a data transform: the raw '   ' is not a
        // null-equivalent, so nullability never fires — it is compared (post-trim) against ''.
        table: { headers: ['a'], rows: [['   '], ['nomatch']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 1, ruleName: 'categoryMismatch', value: 'nomatch' }],
        },
    });

    V({
        name: 'B096: StringMatchStrategy stripSpaces removes ALL space characters, not just internal runs',
        schema: {
            meta: META, resultConfig: RC,
            columns: {
                a: { type: { name: 'categorical', allowedValues: ['redcar'], matchStrategy: { caseSensitive: false, trim: false, stripSpaces: true } } },
            },
        },
        table: { headers: ['a'], rows: [['r e d c a r'], ['red car'], [' red  car ']] },
        expect: { valid: true, cellRegister: [] },
    });

    V({
        name: 'B098: int column minInclusive:false rejects the value exactly at min; the next integer passes',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { type: { name: 'int', value: { min: 0, max: 10, minInclusive: false, maxInclusive: true } } } },
        },
        table: { headers: ['a'], rows: [['0'], ['1']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 0, ruleName: 'rangeBreach', value: '0', context: { minInclusive: false, maxInclusive: true } }],
        },
    });

    V({
        name: 'B098: float column maxInclusive:false rejects the value exactly at max; a value just below passes',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { type: { name: 'float', value: { min: 0, max: 10, minInclusive: true, maxInclusive: false } } } },
        },
        table: { headers: ['a'], rows: [['10'], ['9.99']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 0, ruleName: 'rangeBreach', value: '10', context: { minInclusive: true, maxInclusive: false } }],
        },
    });

    // ---------------- v1.4.0 P8: doc-anchored gaps (B113) ----------------

    V({
        name: 'B113: severity {default, byRule} resolves PER RULE at runtime — only the keyed rule is overridden, others keep default',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'utc' },
            columns: {
                a: {
                    nullable: false,
                    severity: { default: 'error', byRule: { rangeBreach: 'warning' } },
                    type: { name: 'int', value: { min: 0, max: 10, minInclusive: true, maxInclusive: true } },
                },
            },
        },
        table: { headers: ['a'], rows: [[null], [11], ['x']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2, warning: 1 } },
            cellRegister: [
                { row: 0, ruleName: 'nullabilityViolation', severity: 'error' },
                { row: 1, ruleName: 'rangeBreach', severity: 'warning' },
                { row: 2, ruleName: 'typeMismatch', severity: 'error' },
            ],
        },
    });

})();
