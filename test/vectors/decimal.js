/* Unit tests — the first-class `decimal` type (Core §6.10, added in 1.6.0): exact-decimal
 * verdicts for text cells at EVERY surface (value ranges, unique/keys/duplicates, built-in
 * comparison/conditionalRequired/monotonic, sumEquals auto-exact, compare()), plus the
 * rule 59 / rule C4 schema errors and the float-parity (additivity) proofs. */
'use strict';
(function () {
    const U = (name, fn, extra) => window.__UNIT__.push(Object.assign({ suite: 'decimal type', name, fn }, extra));
    const TV = () => window.TableValidation;
    const META = { schemaVersion: '1.0.0', name: 'dec' };
    const RC = { collectCellRegister: true };
    const LOOSE = { strictType: false, timezone: 'utc' };

    // one-column validate() helper
    const run1 = (typeBlock, rows, extra) => TV().validate(Object.assign({
        meta: META, resultConfig: RC, evaluation: LOOSE,
        columns: { a: { type: typeBlock } },
    }, extra || {}), { headers: ['a'], rows: rows.map((c) => [c]) });

    const breachRows = (r, constraint) => {
        const reg = r.cellRegister || [];
        return reg.filter((e) => e.ruleName === 'rangeBreach' && e.context && e.context.constraint === constraint)
            .map((e) => e.row).sort((a, b) => a - b);
    };

    // ---------------- acceptance + precision bounds (§6.10, float-parity) ----------------

    U('precision bounds — mixed "0.11"/"0.2" pass under {min:1,max:2}; integer-shaped text = 0 digits breaches', ({ assert, assertEq }) => {
        const r = run1({ name: 'decimal', precision: { min: 1, max: 2, minInclusive: true, maxInclusive: true } },
            ['0.11', '0.2', '5']);
        assertEq(breachRows(r, 'precision'), [2], 'only "5" (0 fractional digits < min 1) breaches; "0.11"/"0.2" legit-share the column');
        assert(!r.valid, 'the integer-shaped cell is a precision violation');
    });

    U('precision uniform-cents {2,2} rejects "0.2" (1 dp), accepts "0.20"', ({ assertEq }) => {
        const r = run1({ name: 'decimal', precision: { min: 2, max: 2, minInclusive: true, maxInclusive: true } },
            ['0.20', '0.2', '1.00']);
        assertEq(breachRows(r, 'precision'), [1], 'only "0.2" (1 dp) breaches the fixed-2-scale contract');
    });

    U('precision — "12" carries 0 fractional digits (integer-shaped), breaches min 1', ({ assert }) => {
        const r = run1({ name: 'decimal', precision: { min: 1, max: 4, minInclusive: true, maxInclusive: true } }, ['12']);
        assert(!r.valid, 'integer-shaped text has precision 0');
    });

    // ---------------- exact value ranges (§6.10) + the float false-accept additivity ----------------

    U('exact range — "0.3000000000000000001" BREACHES decimal max 0.3 but still PASSES float (D2 additivity)', ({ assert, assertEq }) => {
        const cell = '0.3000000000000000001';
        const rDec = run1({ name: 'decimal', value: { min: null, max: 0.3, minInclusive: true, maxInclusive: true } }, [cell]);
        const rFloat = run1({ name: 'float', value: { min: null, max: 0.3, minInclusive: true, maxInclusive: true } }, [cell]);
        assertEq(breachRows(rDec, 'value'), [0], 'decimal: exact value > 0.3 → breach (float\'s false-accept edge closed)');
        assert(rFloat.valid, 'float: binary64 collapses to 0.3 → still passes (the preserved D2 false-accept proves additivity)');
    });

    U('exact range — 2^46 2-dp class: "100000000000000008.00" breaches decimal max 1e17, passes float', ({ assert, assertEq }) => {
        const cell = '100000000000000008.00';
        const rDec = run1({ name: 'decimal', value: { min: null, max: 1e17, minInclusive: true, maxInclusive: true } }, [cell]);
        const rFloat = run1({ name: 'float', value: { min: null, max: 1e17, minInclusive: true, maxInclusive: true } }, [cell]);
        assertEq(breachRows(rDec, 'value'), [0], 'decimal: exact 1e17+8 > 1e17 → breach');
        assert(rFloat.valid, 'float: rounds to exactly 1e17 → passes');
    });

    U('exact range — exclusive bounds: {min:0,max:0.3, both exclusive} rejects endpoints, accepts interior', ({ assertEq }) => {
        const r = run1({ name: 'decimal', value: { min: 0, max: 0.3, minInclusive: false, maxInclusive: false } },
            ['0', '0.3', '0.15']);
        assertEq(breachRows(r, 'value'), [0, 1], 'both endpoints breach under exclusive bounds; 0.15 is interior');
    });

    // ---------------- unique / duplicate content (§8.4j/8.5c/8.7) ----------------

    U('unique — two distinct ≥2^53 amounts are NOT duplicates on decimal, but ARE on float (additivity)', ({ assert }) => {
        const rows = ['9007199254740993', '9007199254740992'];   // distinct decimals; one binary64
        const uniq = { enabled: true };
        const dec = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { unique: uniq, type: { name: 'decimal' } } } }, { headers: ['a'], rows: rows.map((c) => [c]) });
        const flt = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { unique: uniq, type: { name: 'float' } } } }, { headers: ['a'], rows: rows.map((c) => [c]) });
        assert(dec.valid, 'decimal: the two exact integers differ → no uniqueness violation');
        assert(!flt.valid, 'float: both collapse onto one binary64 → falsely duplicate (the class decimal fixes)');
    });

    U('unique — scale-insensitive equality preserved: "1.5" and "1.50" still collide on decimal', ({ assert }) => {
        const dec = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { unique: { enabled: true }, type: { name: 'decimal' } } } },
            { headers: ['a'], rows: [['1.5'], ['1.50']] });
        assert(!dec.valid, '"1.5" == "1.50" numerically → duplicate (today\'s intended semantics)');
    });

    // ---------------- built-in comparison + conditionalRequired + monotonic ----------------

    U('comparison row check — decimal fields compare in exact decimal (2.13 > 2.03; ≥2^53 pair distinct)', ({ assert }) => {
        const schema = (op) => ({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'decimal' } }, b: { type: { name: 'decimal' } } },
            customRowChecks: [{ name: 'ab', type: 'comparison', fieldA: 'a', fieldB: 'b', op }] });
        const gt = TV().validate(schema('>'), { headers: ['a', 'b'], rows: [['2.13', '2.03']] });
        assert(gt.valid, '2.13 > 2.03 holds exactly');
        const ne = TV().validate(schema('!='), { headers: ['a', 'b'],
            rows: [['9007199254740993', '9007199254740992']] });
        assert(ne.valid, 'two distinct ≥2^53 decimals are != (they would be == in binary64)');
    });

    U('conditionalRequired — decimal if.field compares against the schema literal in exact decimal', ({ assert }) => {
        const schema = { meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { amt: { type: { name: 'decimal' } }, note: { nullable: true, type: { name: 'string' } } },
            customRowChecks: [{ name: 'r', type: 'conditionalRequired',
                if: { field: 'amt', op: '>', value: 0.3 }, then: { field: 'note', nonNull: true } }] };
        // 0.3000000000000000001 > 0.3 exactly → condition met → missing note is a violation
        const hit = TV().validate(schema, { headers: ['amt', 'note'], rows: [['0.3000000000000000001', null]] });
        assert(!hit.valid, 'exact: the cell exceeds 0.3 so the note becomes required');
        // exactly 0.3 → NOT > 0.3 → condition not met → no violation
        const miss = TV().validate(schema, { headers: ['amt', 'note'], rows: [['0.30', null]] });
        assert(miss.valid, 'exactly 0.3 does not satisfy the strict > condition');
    });

    U('monotonic — exact ordering survives the binary64 collapse magnitude', ({ assert }) => {
        const schema = (rows) => TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'decimal' } } },
            customTableChecks: [{ name: 'm', type: 'monotonic', field: 'a', direction: 'increasing' }] },
            { headers: ['a'], rows: rows.map((c) => [c]) });
        const inc = schema(['9007199254740992', '9007199254740993']);
        assert(inc.valid, 'strictly increasing exactly (as binary64 the pair is equal → would falsely break)');
        const flat = schema(['1.50', '1.5']);   // equal values → not strictly increasing
        assert(!flat.valid, '"1.50" then "1.5" is not strictly increasing (scale-insensitive equal)');
    });

    // ---------------- sumEquals auto-exact + rule 59 + native fallback ----------------

    U('sumEquals — decimal reference triggers exact mode with no flag: ten "0.10" sum to 1.00 and pass at tolerance 0', ({ assert }) => {
        const r = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'decimal' } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: 1.00, expectedFieldRow: 'first', tolerance: 0 }] },
            { headers: ['a'], rows: Array.from({ length: 10 }, () => ['0.10']) });
        assert(r.valid, 'exact decimal accumulation: ten 0.10 = 1.00 exactly (binary64 would drift and fail)');
    });

    U('sumEquals — decimal exact mode discloses native-cell rows and carries exact:true in context', ({ assert, assertEq, partial }) => {
        const r = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'decimal' } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: 5.00, expectedFieldRow: 'first', tolerance: 0 }] },
            { headers: ['a'], rows: [['0.10'], [0.2], ['0.30']] });   // row 1 is a native number
        assert(!r.valid, 'sum 0.60 ≠ 5.00');
        partial({ fields: ['a'], expectedSum: '5.00', actualSum: '0.60', tolerance: 0, exact: true, binary64FallbackRows: [1] },
            r.summary.details[0].context, 'exact strings at scale s; the native cell records row 1 as a fallback');
    });

    U('rule 59 — declaring `exact` on a sumEquals that references a decimal column is a schema error', ({ assertEq }) => {
        const r = TV().validate({ meta: META, columns: { a: { type: { name: 'decimal' } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: 1, expectedFieldRow: 'first', exact: true }] },
            { headers: ['a'], rows: [] });
        assertEq(r.abortReason, 'schemaInvalid', 'the exact key must be ABSENT beside a decimal column (rule 59)');
        assertEq(r.summary.details[0].context.path, 'customTableChecks[0].exact', 'the offending path');
    });

    // ---------------- compare() decimal = exact with no flag + rule C4 ----------------

    const cmpSchema = (fields) => ({ meta: META, resultConfig: RC, evaluation: LOOSE,
        structure: { columnMatching: 'byName' },
        columns: { id: { type: { name: 'int' } }, amount: { type: { name: 'decimal' } } },
        comparison: Object.assign({ match: { keys: ['id'] } }, fields ? { fields } : {}) });

    U('compare() — decimal evaluates tolerance exactly with NO flag: 2.13 vs 2.03 at tol 0.1 is a boundary toleranceMatch', ({ assertEq }) => {
        const r = TV().compare(cmpSchema({ amount: { tolerance: 0.1 } }),
            { headers: ['id', 'amount'], rows: [['1', '2.13']] },
            { headers: ['id', 'amount'], rows: [['1', '2.03']] });
        const cd = r.diff.rows[0].cells.amount;
        assertEq(cd.tier, 'toleranceMatch', '|2.13−2.03| = 0.10 sits exactly on 0.1 → passes (exact, no flag)');
        assertEq(cd.delta, '0.10', 'exact-decimal delta string');
    });

    U('compare() — decimal ≥2^53 pair is a valueMismatch (not interpretedMatch as binary64 would give)', ({ assertEq }) => {
        const r = TV().compare(cmpSchema(),
            { headers: ['id', 'amount'], rows: [['1', '9007199254740993']] },
            { headers: ['id', 'amount'], rows: [['1', '9007199254740992']] });
        assertEq(r.diff.rows[0].cells.amount.tier, 'valueMismatch', 'distinct exact decimals → different');
    });

    U('compare() — a native-number cell in a decimal pair records exactFallback "binary64"', ({ assertEq }) => {
        const r = TV().compare(cmpSchema(),
            { headers: ['id', 'amount'], rows: [['1', 2.13]] },       // produced is a native number
            { headers: ['id', 'amount'], rows: [['1', '2.13']] });
        assertEq(r.diff.rows[0].cells.amount.exactFallback, 'binary64', 'native cell has no exact text — discloses the fallback');
    });

    U('rule C4 — declaring `exact` on a decimal comparison field is a schema error', ({ assertEq }) => {
        const r = TV().compare(cmpSchema({ amount: { exact: true } }),
            { headers: ['id', 'amount'], rows: [] }, { headers: ['id', 'amount'], rows: [] });
        assertEq(r.abortReason, 'schemaInvalid', 'exact must be ABSENT on a decimal column (rule C4)');
        assertEq(r.summary.details[0].context.path, 'comparison.fields.amount.exact', 'the offending path');
    });

    // ---------------- float byte-identical (additivity guard) ----------------

    U('float parity — the same config/data on a float column keeps its pre-1.6.0 verdicts', ({ assert }) => {
        // a float column with the exact-range false-accept and binary64 sum drift, unchanged
        const range = run1({ name: 'float', value: { min: null, max: 0.3, minInclusive: true, maxInclusive: true } },
            ['0.3000000000000000001']);
        assert(range.valid, 'float value range stays binary64 (no exact-range flag exists for float)');
        const sum = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'float' } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: 1.00, expectedFieldRow: 'first', tolerance: 0 }] },
            { headers: ['a'], rows: Array.from({ length: 10 }, () => ['0.10']) });
        assert(!sum.valid, 'float sumEquals stays binary64: ten 0.10 drift off 1.00 at tolerance 0');
    });
})();
