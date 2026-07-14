/* Golden vectors — temporal evaluation: T+/-N determinism, zones, formats. All need Luxon. */
'use strict';
(function () {
    const V = (v) => window.__VECTORS__.push(Object.assign({ suite: 'temporal', needsLuxon: true }, v));
    const META = { schemaVersion: '1.0.0', name: 't' };
    const RC = { collectCellRegister: true };

    V({
        name: 'T+/-N — same schema+table, two pinned instants, different outcomes (Phase 3 resolution)',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'utc' },
            columns: {
                d: {
                    type: {
                        name: 'date', formats: ['yyyy-MM-dd'],
                        value: { min: 'T-1', max: 'T+1', minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['d'], rows: [['2026-07-08']] },
        runs: [
            {
                referenceInstant: '2026-07-08T12:00:00Z',
                expect: { valid: true, summary: { bySeverity: { error: 0 } }, cellRegister: [] },
            },
            {
                referenceInstant: '2026-01-15T12:00:00Z',
                expect: {
                    valid: false,
                    summary: { bySeverity: { error: 1 } },
                    cellRegister: [{
                        row: 0, field: 'd', ruleName: 'rangeBreach', value: '2026-07-08',
                        context: {
                            constraint: 'value', min: '2026-01-14', max: '2026-01-16',
                            minInclusive: true, maxInclusive: true,
                        },
                        message: 'value out of range 2026-01-14–2026-01-16',
                    }],
                },
            },
        ],
    });

    V({
        name: 'IANA zone — offset-less datetimes interpreted in Europe/Luxembourg',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'Europe/Luxembourg' },
            columns: {
                dt: {
                    type: {
                        name: 'datetime', formats: ['yyyy-MM-dd HH:mm'],
                        value: {
                            min: '2026-07-08T00:00:00+02:00', max: null,
                            minInclusive: true, maxInclusive: true,
                        },
                    },
                },
            },
        },
        table: { headers: ['dt'], rows: [['2026-07-08 01:00'], ['2026-07-07 23:00']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1 } },
            cellRegister: [{ row: 1, field: 'dt', ruleName: 'rangeBreach', value: '2026-07-07 23:00' }],
        },
    });

    V({
        name: 'date format dd.MM.yyyy — whole-string acceptance, invalid calendar dates rejected',
        schema: {
            meta: META, resultConfig: RC,
            columns: { d: { type: { name: 'date', formats: ['dd.MM.yyyy'] } } },
        },
        table: { headers: ['d'], rows: [['15.07.2026'], ['2026-07-15'], ['31.02.2026']] },
        expect: {
            valid: false,
            summary: {
                bySeverity: { error: 2 },
                details: [{
                    ruleName: 'typeMismatch', fieldName: 'd', count: 2,
                    context: { expectedType: 'date', actualType: 'string' },
                }],
            },
            cellRegister: [
                { row: 1, ruleName: 'typeMismatch', value: '2026-07-15' },
                { row: 2, ruleName: 'typeMismatch', value: '31.02.2026' },
            ],
        },
    });

    V({
        name: 'time type — HH:mm range without midnight wrap; single-digit hour rejected',
        schema: {
            meta: META, resultConfig: RC,
            columns: {
                t: {
                    type: {
                        name: 'time', formats: ['HH:mm'],
                        value: { min: '08:00', max: '17:00', minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['t'], rows: [['09:30'], ['18:00'], ['9:30']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2 } },
            cellRegister: [
                {
                    row: 1, ruleName: 'rangeBreach', value: '18:00',
                    context: { constraint: 'value', min: '08:00', max: '17:00' },
                },
                { row: 2, ruleName: 'typeMismatch', value: '9:30' },
            ],
        },
    });

    V({
        name: 'explicit offset (ZZ) takes precedence for the instant, then converts to schema zone',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'utc' },
            columns: {
                dt: {
                    type: {
                        name: 'datetime', formats: ["yyyy-MM-dd'T'HH:mmZZ"],
                        value: {
                            min: '2026-07-08T09:00:00Z', max: null,
                            minInclusive: true, maxInclusive: true,
                        },
                    },
                },
            },
        },
        table: { headers: ['dt'], rows: [['2026-07-08T10:00+02:00']] },   // = 08:00Z < 09:00Z
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1 } },
            cellRegister: [{ row: 0, ruleName: 'rangeBreach', value: '2026-07-08T10:00+02:00' }],
        },
    });

    // ---------------- v1.3.0: yy exact-2-digit pin + pivot century mapping + SSSSSS ----------------

    V({
        name: 'yy (1.3.0): exactly two digits — 4-digit years REJECT under dd/MM/yy (Luxon lenience guarded)',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            columns: { d: { type: { name: 'date', formats: ['dd/MM/yy'] } } },
        },
        table: { headers: ['d'], rows: [['30/06/19'], ['30/06/2019']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 1, ruleName: 'typeMismatch' }],
        },
    });

    V({
        name: 'yy (1.3.0): default pivot 1961 maps 19→2019, 61→1961; range check sees the mapped years',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            columns: {
                d: {
                    type: {
                        name: 'date', formats: ['dd/MM/yy'],
                        value: { min: '2000-01-01', max: '2060-12-31', minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['d'], rows: [['30/06/19'], ['30/06/61']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 1, ruleName: 'rangeBreach' }],   // 61 → 1961, below min
        },
    });

    V({
        name: 'yy (1.3.0): evaluation.twoDigitYearPivot 1900 maps 19→1919 (vintage feeds expressible)',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'utc', twoDigitYearPivot: 1900 },
            columns: {
                d: {
                    type: {
                        name: 'date', formats: ['dd/MM/yy'],
                        value: { min: '1900-01-01', max: '1999-12-31', minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['d'], rows: [['30/06/19'], ['30/06/99']] },
        expect: { valid: true, summary: { bySeverity: { error: 0, warning: 0 } } },
    });

    V({
        name: 'yy (1.3.0): column-level pivot override beats the table level (§3.4)',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            columns: {
                birth: {
                    evaluation: { twoDigitYearPivot: 1900 },
                    type: {
                        name: 'date', formats: ['dd/MM/yy'],
                        value: { min: '1900-01-01', max: '1999-12-31', minInclusive: true, maxInclusive: true },
                    },
                },
                expiry: {
                    type: {
                        name: 'date', formats: ['dd/MM/yy'],
                        value: { min: '2000-01-01', max: '2060-12-31', minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['birth', 'expiry'], rows: [['30/06/34', '30/06/34']] },   // 1934 vs 2034
        expect: { valid: true, summary: { bySeverity: { error: 0, warning: 0 } } },
    });

    V({
        name: 'SSSSSS (1.3.0): six-digit DB timestamps parse; five digits reject',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            columns: { ts: { type: { name: 'datetime', formats: ['yyyy-MM-dd HH:mm:ss.SSSSSS'] } } },
        },
        table: { headers: ['ts'], rows: [['2026-07-15 14:30:45.123456'], ['2026-07-15 14:30:45.12345']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 1, ruleName: 'typeMismatch' }],
        },
    });

    // ---------------- v1.4.0 coverage vectors (P6 — §13 format-guard edges) ----------------

    // B099 — bare yyyy rejects a 3-digit year (Core §13.3 digit-count discipline: yyyy is exactly 4 digits).
    V({
        name: 'B099: yyyy format — 3-digit year rejected, 4-digit accepted',
        schema: {
            meta: META, resultConfig: RC,
            columns: { d: { type: { name: 'date', formats: ['yyyy-MM-dd'] } } },
        },
        table: { headers: ['d'], rows: [['2015-06-30'], ['015-06-30']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 1, ruleName: 'typeMismatch', value: '015-06-30' }],
        },
    });

    // B099 — adjacent-digit-token strictness: unseparated ddMMyy demands the exact total digit count
    // (the structural pre-regex is anchored ^...$, so under- and over-length strings both reject).
    V({
        name: 'B099: ddMMyy (no separators) — exact 6-digit total length enforced',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            columns: { d: { type: { name: 'date', formats: ['ddMMyy'] } } },
        },
        table: { headers: ['d'], rows: [['300619'], ['30619'], ['3006190']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 2, warning: 0 } },
            cellRegister: [
                { row: 1, ruleName: 'typeMismatch', value: '30619' },
                { row: 2, ruleName: 'typeMismatch', value: '3006190' },
            ],
        },
    });

    // B099 — quoted-literal safety: a literal 'yy' inside quotes is matched as literal text, never as
    // the pivot-substituted yy token (Core §13.3; dist luxSpecialFormat treats quoted spans as {lit}).
    V({
        name: "B099: quoted-literal \"'yy'\" is literal text, not the yy token (no pivot substitution)",
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            columns: { d: { type: { name: 'date', formats: ["yy'yy'-MM-dd"] } } },
        },
        table: { headers: ['d'], rows: [['19yy-06-30'], ['1919-06-30']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 1, ruleName: 'typeMismatch', value: '1919-06-30' }],
        },
    });

    // B099 — the '60' → 2060 upper pivot boundary: default pivot 1961 maps the two-digit year range
    // to [1961, 2060]; '60' is the top of that window (→ 2060), one below the next '61' → 1961 wrap.
    V({
        name: "B099: default pivot upper boundary — '60' maps to 2060, '61' maps to 1961",
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            columns: {
                hi: {
                    type: {
                        name: 'date', formats: ['dd/MM/yy'],
                        value: { min: '2059-01-01', max: '2061-12-31', minInclusive: true, maxInclusive: true },
                    },
                },
                lo: {
                    type: {
                        name: 'date', formats: ['dd/MM/yy'],
                        value: { min: '1960-01-01', max: '1962-12-31', minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['hi', 'lo'], rows: [['30/06/60', '30/06/61']] },
        expect: { valid: true, summary: { bySeverity: { error: 0, warning: 0 } } },
    });

    // B099 — SSSSSS is exactly six digits: a seven-digit fraction rejects (structural pre-regex, not
    // just Luxon's native SSS).
    V({
        name: 'B099: SSSSSS format — seven-digit fraction rejected',
        schema: {
            meta: { schemaVersion: '1.3.0', name: 't' }, resultConfig: RC,
            columns: { ts: { type: { name: 'datetime', formats: ['yyyy-MM-dd HH:mm:ss.SSSSSS'] } } },
        },
        table: { headers: ['ts'], rows: [['2026-07-15 14:30:45.1234567']] },
        expect: {
            valid: false,
            summary: { bySeverity: { error: 1, warning: 0 } },
            cellRegister: [{ row: 0, ruleName: 'typeMismatch', value: '2026-07-15 14:30:45.1234567' }],
        },
    });

    // B099 — T±N is calendar-day arithmetic across a DST transition: America/New_York springs forward
    // 2026-03-08 (a 23-hour local day), but T+1 from a reference on 2026-03-07 still lands on the next
    // CALENDAR day (2026-03-08), not a wall-clock +24h that a naive instant-add would produce.
    V({
        name: 'B099: T+1 calendar-day arithmetic across a DST spring-forward boundary (America/New_York)',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'America/New_York' },
            columns: {
                d: {
                    type: {
                        name: 'date', formats: ['yyyy-MM-dd'],
                        value: { min: 'T+1', max: 'T+1', minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: { headers: ['d'], rows: [['2026-03-08']] },
        runs: [
            {
                referenceInstant: '2026-03-07T12:00:00-05:00',
                expect: { valid: true, summary: { bySeverity: { error: 0 } }, cellRegister: [] },
            },
        ],
    });

    // B097 — on a DATETIME column (unlike a date column), T+/-N resolves to an exact instant
    // offset from referenceInstant (ref ± N calendar days, then compared as a millisecond
    // instant), NOT a calendar-day snap to start/end of day. With referenceInstant pinned to
    // 2026-07-13T12:00:00Z and value:{min:'T-1',max:'T+1'}, the window is the exact 24h span
    // [2026-07-12T12:00:00Z, 2026-07-14T12:00:00Z] (both inclusive) — one second on either side
    // of that exact instant breaches, unlike a date column's whole-day resolution.
    V({
        name: 'B097: T+/-N on a datetime column resolves to an exact-instant window, not a calendar-day snap',
        schema: {
            meta: META, resultConfig: RC,
            evaluation: { strictType: true, timezone: 'utc' },
            columns: {
                d: {
                    type: {
                        name: 'datetime', formats: ["yyyy-MM-dd'T'HH:mm:ss'Z'"],
                        value: { min: 'T-1', max: 'T+1', minInclusive: true, maxInclusive: true },
                    },
                },
            },
        },
        table: {
            headers: ['d'],
            rows: [['2026-07-14T12:00:00Z'], ['2026-07-14T12:00:01Z'], ['2026-07-12T11:59:59Z']],
        },
        runs: [
            {
                referenceInstant: '2026-07-13T12:00:00Z',
                expect: {
                    valid: false,
                    summary: { bySeverity: { error: 2 } },
                    cellRegister: [
                        {
                            row: 1, field: 'd', ruleName: 'rangeBreach', value: '2026-07-14T12:00:01Z',
                            context: {
                                constraint: 'value',
                                min: '2026-07-12T12:00:00.000Z', max: '2026-07-14T12:00:00.000Z',
                                minInclusive: true, maxInclusive: true,
                            },
                        },
                        {
                            row: 2, field: 'd', ruleName: 'rangeBreach', value: '2026-07-12T11:59:59Z',
                            context: {
                                constraint: 'value',
                                min: '2026-07-12T12:00:00.000Z', max: '2026-07-14T12:00:00.000Z',
                                minInclusive: true, maxInclusive: true,
                            },
                        },
                    ],
                },
            },
        ],
    });

})();
