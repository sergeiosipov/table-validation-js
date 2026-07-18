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

    // ---------------- v1.6.0 P3: acceptance edges, allowBareDecimal, hasPattern, strictType, negativeStyle ----------------

    U('formats-based acceptance — German-style grouping+decimal on a decimal column: accepted with formats declared, rejected without', ({ assert }) => {
        const withFormats = run1({ name: 'decimal', formats: [{ decimalSeparator: ',', groupingSeparators: ['.'] }],
            value: { min: 1234.56, max: 1234.56, minInclusive: true, maxInclusive: true } }, ['1.234,56']);
        assert(withFormats.valid, '"1.234,56" under the declared format reads exactly 1234.56 (an inclusive-boundary pass proves the working copy)');
        const noFormats = run1({ name: 'decimal' }, ['1.234,56']);
        assert(!noFormats.valid, 'the same cell with no declared format fails the direct-parse grammar (grouping/decimal chars are illegal there)');
    });

    U('direct-parse edges — decimal mirrors float\'s actual behavior exactly: accepts "+1.5"/"-0.0"/"007.10" (leading zeros)/"12"; rejects ".85" (no allowBareDecimal), "1e5", "NaN", "Infinity", "1.", "1..2", ""', ({ assert }) => {
        for (const cell of ['+1.5', '-0.0', '007.10', '12']) {
            const dec = run1({ name: 'decimal' }, [cell]);
            const flt = run1({ name: 'float' }, [cell]);
            assert(dec.valid, `decimal accepts ${JSON.stringify(cell)} under the shared direct-parse grammar`);
            assert(flt.valid, `float accepts it too — checked first, mirrored: leading zeros are legal for float today`);
        }
        for (const cell of ['.85', '1e5', 'NaN', 'Infinity', '1.', '1..2', '']) {
            const dec = run1({ name: 'decimal' }, [cell]);
            assert(!dec.valid, `decimal rejects ${JSON.stringify(cell)} (no allowBareDecimal / no exponent-NaN-Infinity grammar / incomplete fraction; "" is not null-equivalent by default so it hits the same typeMismatch)`);
        }
    });

    U('allowBareDecimal on a decimal format — ".85" accepted, precision 2, value exactly 0.85', ({ assert }) => {
        const r = run1({ name: 'decimal', formats: [{ decimalSeparator: '.', groupingSeparators: [','], allowBareDecimal: true }],
            precision: { min: 2, max: 2, minInclusive: true, maxInclusive: true },
            value: { min: 0.85, max: 0.85, minInclusive: true, maxInclusive: true } }, ['.85']);
        assert(r.valid, 'bare decimal ".85" completes to working copy "0.85": precision 2, exact value 0.85 (inclusive-boundary pass)');
    });

    U('hasPattern contract — a declared non-null pattern SUPPRESSES the direct-parse fallback on decimal', ({ assert }) => {
        const r = run1({ name: 'decimal', formats: [{ decimalSeparator: '.', groupingSeparators: [','], pattern: '#,##0.00' }] }, ['1234.50']);
        assert(!r.valid, '"1234.50" is legal under the bare direct-parse grammar but the pattern requires grouping — rejected, not silently accepted by falling back');
    });

    U('precision Range forms — min-only, max-only Ranges; native-number precision counts from canonical rendering (the trailing-zero caveat)', ({ assert }) => {
        const minOnly = run1({ name: 'decimal', precision: { min: 3, max: null, minInclusive: true, maxInclusive: true } }, ['1.234']);
        assert(minOnly.valid, 'min-only Range: 3 fractional digits clears min 3');
        const maxOnly = run1({ name: 'decimal', precision: { min: null, max: 2, minInclusive: true, maxInclusive: true } }, ['1.234']);
        assert(!maxOnly.valid, 'max-only Range: 3 fractional digits breaches max 2');
        const native = run1({ name: 'decimal', precision: { min: 2, max: 2, minInclusive: true, maxInclusive: true } }, [1.50]);
        assert(!native.valid, 'native 1.50 canonically renders "1.5" (§1.5 shortest round-trip) — precision 1, breaches {min:2,max:2} (the asserted trailing-zero caveat)');
    });

    U('strictType true — string "1.50" is typeMismatch, native 1.5 accepted; declaring formats fires the SAME advisory float fires (mirrored, checked first)', ({ assert, assertEq }) => {
        const strictCfg = { evaluation: { strictType: true, timezone: 'utc' } };
        const str = run1({ name: 'decimal' }, ['1.50'], strictCfg);
        assert(!str.valid, 'strictType true rejects a string cell for decimal exactly as for float');
        assertEq(str.summary.details[0].ruleName, 'typeMismatch', 'typeMismatch');
        const nat = run1({ name: 'decimal' }, [1.5], strictCfg);
        assert(nat.valid, 'a native number is always accepted under strictType true');
        const decAdv = run1({ name: 'decimal', formats: [{ decimalSeparator: '.', groupingSeparators: [','] }] }, [1.5], strictCfg);
        const fltAdv = run1({ name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [','] }] }, [1.5], strictCfg);
        assertEq(decAdv.summary.details[0].ruleName, 'irrelevantSetting', 'irrelevantSetting, not an error — both stay valid');
        assertEq(decAdv.summary.details[0].context, fltAdv.summary.details[0].context,
            'decimal fires the IDENTICAL irrelevantSetting advisory context float fires for a declared-but-unused formats array');
    });

    U('negativeStyle parentheses + trailingMinus on a decimal NumberFormat: exact negative value from either spelling', ({ assert }) => {
        const paren = run1({ name: 'decimal', formats: [{ decimalSeparator: ',', groupingSeparators: ['.'], negativeStyle: 'parentheses' }],
            value: { min: -1234.50, max: -1234.50, minInclusive: true, maxInclusive: true } }, ['(1.234,50)']);
        assert(paren.valid, '"(1.234,50)" under parentheses negativeStyle reads exactly -1234.50 (inclusive-boundary pass)');
        const trailing = run1({ name: 'decimal', formats: [{ decimalSeparator: '.', groupingSeparators: [], negativeStyle: 'trailingMinus' }],
            value: { min: -1234.50, max: -1234.50, minInclusive: true, maxInclusive: true } }, ['1234.50-']);
        assert(trailing.valid, '"1234.50-" under trailingMinus negativeStyle reads exactly -1234.50 (inclusive-boundary pass)');
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

    U('exact range — inclusive boundary: "0.30" AT max 0.3 passes; a SECOND bound-inflation twin (max 0.1) rejects on decimal but passes on float', ({ assert }) => {
        const atBound = run1({ name: 'decimal', value: { min: null, max: 0.3, minInclusive: true, maxInclusive: true } }, ['0.30']);
        assert(atBound.valid, '"0.30" == 0.3 exactly, inclusive bound → passes');
        const cell = '0.10000000000000000555';
        const rDec = run1({ name: 'decimal', value: { min: null, max: 0.1, minInclusive: true, maxInclusive: true } }, [cell]);
        const rFloat = run1({ name: 'float', value: { min: null, max: 0.1, minInclusive: true, maxInclusive: true } }, [cell]);
        assert(!rDec.valid, 'decimal: exact value > 0.1 → breach (a second bound/cell — the additivity proof generalizes beyond the P2 max-0.3 case)');
        assert(rFloat.valid, 'float: binary64 collapses "0.10000000000000000555" to exactly 0.1 → still passes');
    });

    U('exact range — exclusive bounds: cell text exactly AT a bound breaches; one ulp-of-text above/below lands on the correct side', ({ assertEq }) => {
        const r = run1({ name: 'decimal', value: { min: 0.3, max: 0.4, minInclusive: false, maxInclusive: false } },
            ['0.3', '0.30000000000000000001', '0.4', '0.39999999999999999999']);
        assertEq(breachRows(r, 'value'), [0, 2],
            'both AT-bound cells (index 0 = min, index 2 = max) breach; one ulp-of-text above min and one ulp-of-text below max are interior and pass');
    });

    U('exact range — 2^46 2-dp class: breaches on BOTH sides of BOTH bounds; the interior cell passes', ({ assertEq }) => {
        const r = run1({ name: 'decimal', value: { min: 1e17, max: 1e17 + 100, minInclusive: true, maxInclusive: true } },
            ['99999999999999999.99', '100000000000000008.00', '100000000000000108.00']);
        assertEq(breachRows(r, 'value'), [0, 2], 'below-min (index 0) and above-max (index 2) breach; the interior cell (index 1) passes');
    });

    U('exact range — a ≥2^53 pair where binary64 collapses: decimal orders correctly on an exclusive bound; float mis-orders (the collapse produces a WRONG verdict)', ({ assertEq }) => {
        const cells = ['9007199254740993.00', '9007199254740992.00'];
        const rDec = run1({ name: 'decimal', value: { min: 9007199254740992, max: null, minInclusive: false, maxInclusive: true } }, cells);
        const rFlt = run1({ name: 'float', value: { min: 9007199254740992, max: null, minInclusive: false, maxInclusive: true } }, cells);
        assertEq(breachRows(rDec, 'value'), [1], 'decimal: 9007199254740993 > 9007199254740992 (exclusive min) → passes; 9007199254740992 itself → breach');
        assertEq(breachRows(rFlt, 'value'), [0, 1],
            'float: Number("...993.00") collapses onto the SAME double as the excluded bound → row 0 ALSO breaches, which is the wrong verdict for the true value 9007199254740993');
    });

    U('exact range — negatives: min -0.5 boundary; -0.0/0.0 numeric equality holds against min 0 inclusive AND exclusive', ({ assertEq }) => {
        const neg = run1({ name: 'decimal', value: { min: -0.5, max: null, minInclusive: true, maxInclusive: true } }, ['-0.50', '-0.51']);
        assertEq(breachRows(neg, 'value'), [1], '"-0.50" == -0.5 exactly (inclusive) → passes; "-0.51" < -0.5 → breach');
        const zeroIncl = run1({ name: 'decimal', value: { min: 0, max: null, minInclusive: true, maxInclusive: true } }, ['-0.0', '0.0']);
        assertEq(breachRows(zeroIncl, 'value'), [], '-0.0 and 0.0 are numerically equal to 0 → both pass an inclusive min:0');
        const zeroExcl = run1({ name: 'decimal', value: { min: 0, max: null, minInclusive: false, maxInclusive: true } }, ['-0.0', '0.0']);
        assertEq(breachRows(zeroExcl, 'value'), [0, 1], 'the SAME numeric-zero equality means both breach an exclusive min:0 (neither is strictly > 0)');
    });

    U('exact range — native-cell ranges: a decimal column gives the SAME verdict a float column gives at an identical collapse magnitude (§6.10 order-isomorphism note, tested)', ({ assertEq }) => {
        const rangeCfg = { value: { min: 1e17, max: 1e17 + 100, minInclusive: true, maxInclusive: true } };
        const decPass = run1(Object.assign({ name: 'decimal' }, rangeCfg), [100000000000000008]);
        const fltPass = run1(Object.assign({ name: 'float' }, rangeCfg), [100000000000000008]);
        assertEq(decPass.valid, true, 'sanity: this native cell is inside the range');
        assertEq(decPass.valid, fltPass.valid, 'both pass: a native cell compares directly in binary64 on either type — no fallback disclosure needed');
        const decBreach = run1(Object.assign({ name: 'decimal' }, rangeCfg), [100000000000000108]);
        const fltBreach = run1(Object.assign({ name: 'float' }, rangeCfg), [100000000000000108]);
        assertEq(decBreach.valid, false, 'sanity: this native cell is outside the range');
        assertEq(decBreach.valid, fltBreach.valid, 'both breach: same magnitude, same native double, same verdict');
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

    U('unique — "+1.5"/"1.5"/"1.50" collide as ONE violation set; "-0.0" collides with "0"; decimal-text "1.5" collides with native 1.5', ({ assert }) => {
        const dupSet = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { unique: { enabled: true }, type: { name: 'decimal' } } } },
            { headers: ['a'], rows: [['+1.5'], ['1.5'], ['1.50']] });
        assert(!dupSet.valid, 'leading-sign spelling and trailing-zero scale are all the same decimal 1.5 — one collision set');
        const negZero = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { unique: { enabled: true }, type: { name: 'decimal' } } } },
            { headers: ['a'], rows: [['-0.0'], ['0']] });
        assert(!negZero.valid, '"-0.0" and "0" are the same exact decimal value (§6.10: -0 == 0)');
        const textNative = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { unique: { enabled: true }, type: { name: 'decimal' } } } },
            { headers: ['a'], rows: [['1.5'], [1.5]] });
        assert(!textNative.valid, 'a decimal-text cell and a native number of the same value collide too — both key on the same exact decimal');
    });

    U('composite keys (§8.7 7b) with a decimal component: a scale-variant pair merges into one violation; a ≥2^53 distinct pair does not', ({ assert, assertEq }) => {
        const r = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'int' } }, b: { type: { name: 'decimal' } } },
            compositeKeys: [{ columns: ['a', 'b'] }] },
            { headers: ['a', 'b'], rows: [['1', '1.5'], ['1', '1.50'], ['2', '9007199254740993'], ['2', '9007199254740992']] });
        assert(!r.valid, 'the (1, "1.5")/(1, "1.50") pair is a scale-variant duplicate key');
        const viol = (r.cellRegister || []).filter((e) => e.ruleName === 'compositeKeyViolation');
        const violRows = [...new Set(viol.map((e) => e.row))].sort((x, y) => x - y);
        assertEq(violRows, [0, 1], 'exactly rows 0 and 1 violate (one entry per key column, hence per-row duplicates in viol itself); the (2, ...993)/(2, ...992) pair keys distinctly and is absent from the violation set');
        assertEq(viol.length, 4, 'R×S entries: 2 violating rows × 2 key columns (a, b)');
    });

    U('duplicate row (5c) and duplicate column content (4j) with decimal columns: scale-variant merges, ≥2^53 stays distinct', ({ assert }) => {
        const row = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            structure: { allowDuplicateRows: false },
            columns: { a: { type: { name: 'decimal' } }, b: { type: { name: 'string' } } } },
            { headers: ['a', 'b'], rows: [['1.5', 'x'], ['1.50', 'x'], ['9007199254740993', 'y'], ['9007199254740992', 'y']] });
        assert(!row.valid, 'row 1 duplicates row 0 (scale-variant "a", identical "b")');
        const rowViol = (row.cellRegister || []).filter((e) => e.ruleName === 'duplicateRow');
        assert(rowViol.length === 1 && rowViol[0].row === 1,
            'exactly one duplicateRow entry, at row 1; rows 2/3 (≥2^53 distinct "a") are not flagged');

        const col = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            structure: { allowDuplicateColumns: false },
            columns: { a: { type: { name: 'decimal' } }, b: { type: { name: 'decimal' } }, c: { type: { name: 'decimal' } } } },
            { headers: ['a', 'b', 'c'], rows: [['1.5', '1.50', '9007199254740993'], ['2.5', '2.500', '9007199254740992']] });
        assert(!col.valid, 'column b duplicates column a (scale-variant content, same rows)');
        const colViol = (col.cellRegister || []).filter((e) => e.ruleName === 'duplicateColumnContent');
        assert(colViol.length === 1 && colViol[0].field === 'b',
            'exactly one duplicateColumnContent entry, on b; column c (≥2^53-scale distinct content) is not flagged');
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

    U('monotonic — nonDecreasing passes on the equal scale-variant neighbor; strict order is enforced through the binary64 collapse in BOTH directions', ({ assert }) => {
        const schema = (rows, direction) => TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'decimal' } } },
            customTableChecks: [{ name: 'm', type: 'monotonic', field: 'a', direction }] },
            { headers: ['a'], rows: rows.map((c) => [c]) });
        const nd = schema(['1.5', '1.50'], 'nonDecreasing');
        assert(nd.valid, 'nonDecreasing tolerates the equal (scale-variant) neighbor that "increasing" rejects');
        const dec = schema(['9007199254740993', '9007199254740992'], 'decreasing');
        assert(dec.valid, 'decreasing: the exact order (993 then 992) holds even though binary64 would see the pair as equal');
        const brokenDec = schema(['9007199254740992', '9007199254740993'], 'decreasing');
        assert(!brokenDec.valid, 'reversed input is NOT decreasing exactly — the exact order breaks the check where binary64 equality would have silently passed it');
    });

    U('conditionalRequired — a ≥2^53-magnitude if.value literal matches ONLY the exact text, not the binary64 neighbor', ({ assert }) => {
        const schema = { meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { amt: { type: { name: 'decimal' } }, note: { nullable: true, type: { name: 'string' } } },
            customRowChecks: [{ name: 'r', type: 'conditionalRequired',
                if: { field: 'amt', op: '==', value: 9007199254740992 }, then: { field: 'note', nonNull: true } }] };
        const neighbor = TV().validate(schema, { headers: ['amt', 'note'], rows: [['9007199254740993.00', null]] });
        assert(neighbor.valid, 'the exact-distinct neighbor does NOT satisfy == (binary64 would have false-matched it)');
        const exact = TV().validate(schema, { headers: ['amt', 'note'], rows: [['9007199254740992.00', null]] });
        assert(!exact.valid, 'the exact match DOES satisfy == and the note becomes required');
    });

    U('comparison row check "<" on decimal; mixed decimal/float operands route through operandDec (decimal working copy vs float canonical rendering)', ({ assert }) => {
        const schema = (aType, bType) => ({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: aType } }, b: { type: { name: bType } } },
            customRowChecks: [{ name: 'ab', type: 'comparison', fieldA: 'a', fieldB: 'b', op: '<' }] });
        const bothDec = TV().validate(schema('decimal', 'decimal'),
            { headers: ['a', 'b'], rows: [['9007199254740992.00', '9007199254740993.00']] });
        assert(bothDec.valid, 'decimal < decimal: exact order holds where binary64 would see equality');
        const mixedText = TV().validate(schema('decimal', 'float'), { headers: ['a', 'b'], rows: [['2.03', '2.13']] });
        assert(mixedText.valid, 'mixed decimal(a) < float(b), both text: 2.03 < 2.13');
        const mixedNative = TV().validate(schema('decimal', 'float'), { headers: ['a', 'b'], rows: [['2.03', 2.13]] });
        assert(mixedNative.valid, 'mixed decimal(a) text < float(b) native: the float operand contributes its canonical rendering, the decimal its working copy');
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

    U('rule 59 — the schema error fires under BOTH polarities: exact:false is ALSO forbidden beside a decimal column (P2 covered exact:true)', ({ assertEq }) => {
        const r = TV().validate({ meta: META, columns: { a: { type: { name: 'decimal' } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: 1, expectedFieldRow: 'first', exact: false }] },
            { headers: ['a'], rows: [] });
        assertEq(r.abortReason, 'schemaInvalid', 'exact:false beside a decimal column is unsatisfiable too — also a rule 59 error, not a silent no-op');
        assertEq(r.summary.details[0].context.path, 'customTableChecks[0].exact', 'the offending path names rule 59 in its message');
    });

    U('sumEquals — trigger via expectedField ONLY: a float-summed check with a decimal expectedField enters exact mode; the same shape with a float expectedField is the binary64 control twin', ({ assert }) => {
        const run = (totalType) => TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { x: { type: { name: 'float' } }, total: { type: { name: totalType } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['x'], expectedField: 'total', expectedFieldRow: 'first', tolerance: 0 }] },
            { headers: ['x', 'total'], rows: Array.from({ length: 10 }, () => ['0.10', '1.00']) });
        assert(run('decimal').valid, 'expectedField alone is decimal → exact mode: ten "0.10" sum to exactly 1.00, passes at tolerance 0');
        assert(!run('float').valid, 'control twin: expectedField is float → binary64 mode, ten "0.10" drift off 1.00, fails');
    });

    U('sumEquals — exact tolerance boundary: delta exactly equal to tolerance passes; one hundredth further fails', ({ assert, assertEq }) => {
        const run = (cell, tolerance) => TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'decimal' } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: 10.00, expectedFieldRow: 'first', tolerance }] },
            { headers: ['a'], rows: [[cell]] });
        const boundary = run('10.05', 0.05);
        assert(boundary.valid, '|10.05 − 10.00| = 0.05 sits exactly on tolerance 0.05 → passes (exact-decimal boundary)');
        const over = run('10.06', 0.05);
        assert(!over.valid, 'one cent further breaches the tolerance');
        assertEq(over.summary.details[0].context,
            { fields: ['a'], expectedSum: '10.00', actualSum: '10.06', tolerance: 0.05, exact: true, binary64FallbackRows: [] },
            'actualSum/expectedSum are exact-decimal strings at scale 2; tolerance itself stays the raw schema number — §7.2 Rendering pins only actualSum/expectedSum as exact strings, unlike compare()\'s CellDiff');
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

    U('rule C4 — declaring `exact:false` on a decimal comparison field is ALSO a schema error (P2 covered exact:true)', ({ assertEq }) => {
        const r = TV().compare(cmpSchema({ amount: { exact: false } }),
            { headers: ['id', 'amount'], rows: [] }, { headers: ['id', 'amount'], rows: [] });
        assertEq(r.abortReason, 'schemaInvalid', 'exact:false is unsatisfiable beside a decimal column too — rule C4');
        assertEq(r.summary.details[0].context.path, 'comparison.fields.amount.exact', 'the offending path');
    });

    U('compare() match keys (§15.6) — a decimal key column: ≥2^53 distinct keys pair separately (no false merge); "1.5"/"1.50" keys pair together', ({ assertEq }) => {
        const schema = { meta: META, resultConfig: RC, evaluation: LOOSE,
            structure: { columnMatching: 'byName' },
            columns: { amount: { type: { name: 'decimal' } }, note: { type: { name: 'string' } } },
            comparison: { match: { keys: ['amount'] } } };
        const distinct = TV().compare(schema,
            { headers: ['amount', 'note'], rows: [['9007199254740993', 'p']] },
            { headers: ['amount', 'note'], rows: [['9007199254740992', 'e']] });
        assertEq(distinct.summary.rowsMatched, 0, 'distinct exact decimals never pair as a match key, even though binary64 would collapse them');
        assertEq(distinct.summary.rowsMissing, 1, 'the expected-side key is unmatched (rowMissing)');
        assertEq(distinct.summary.rowsUnexpected, 1, 'the produced-side key is unmatched (rowUnexpected)');
        const collide = TV().compare(schema,
            { headers: ['amount', 'note'], rows: [['1.5', 'p']] },
            { headers: ['amount', 'note'], rows: [['1.50', 'e']] });
        assertEq(collide.summary.rowsMatched, 1, '"1.5" and "1.50" are the same exact decimal key → pair together');
    });

    U('compare() — tolerance forms on a decimal column, each exact: percent and field forms drive the SAME 2.13/2.03-at-0.1 pass as the plain-number form (P2)', ({ assertEq }) => {
        const percentSchema = { meta: META, resultConfig: RC, evaluation: LOOSE,
            structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, base: { type: { name: 'decimal' } }, amount: { type: { name: 'decimal' } } },
            comparison: { match: { keys: ['id'] }, fields: { amount: { tolerance: { percent: 1, of: 'base' } } } } };
        const pr = TV().compare(percentSchema,
            { headers: ['id', 'base', 'amount'], rows: [['1', '10.00', '2.13']] },
            { headers: ['id', 'base', 'amount'], rows: [['1', '10.00', '2.03']] });
        const pc = pr.diff.rows[0].cells.amount;
        assertEq(pc.tier, 'toleranceMatch', 'percent form: 1% of base 10.00 = exact ε 0.1000; the 0.10 delta sits on the boundary');
        assertEq(pc.delta, '0.10', 'exact-decimal delta string');

        const fieldSchema = { meta: META, resultConfig: RC, evaluation: LOOSE,
            structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, tol: { type: { name: 'decimal' } }, amount: { type: { name: 'decimal' } } },
            comparison: { match: { keys: ['id'] }, fields: { amount: { tolerance: { field: 'tol', from: 'expected' } } } } };
        const fr = TV().compare(fieldSchema,
            { headers: ['id', 'tol', 'amount'], rows: [['1', '0.10', '2.13']] },
            { headers: ['id', 'tol', 'amount'], rows: [['1', '0.10', '2.03']] });
        const fc = fr.diff.rows[0].cells.amount;
        assertEq(fc.tier, 'toleranceMatch', 'field form: the driving cell\'s own exact text (0.10) is the boundary');
        assertEq(fc.delta, '0.10', 'exact-decimal delta string');
    });

    U('compare() — interpretedMatch tier for "1.50" vs "1.5" (equal after interpretation, spelling differs); byte-identical spellings are the exact tier', ({ assertEq }) => {
        const interp = TV().compare(cmpSchema(), { headers: ['id', 'amount'], rows: [['1', '1.50']] },
            { headers: ['id', 'amount'], rows: [['1', '1.5']] });
        assertEq(interp.diff.rows[0].cells.amount.tier, 'interpretedMatch', 'same exact value, different spelling');
        const exact = TV().compare(cmpSchema(), { headers: ['id', 'amount'], rows: [['1', '1.5']] },
            { headers: ['id', 'amount'], rows: [['1', '1.5']] });
        assertEq(exact.diff.rows[0].cells.amount.tier, 'exact', 'byte-identical raw spellings');
    });

    U('compare() — exactFallback pair-level: text-vs-native AND native-vs-native carry exactFallback "binary64" + a numeric delta; text-vs-text carries a string delta and no exactFallback — all within ONE column\'s diffs (§15.9 typing note)', ({ assertEq }) => {
        const schema = { meta: META, resultConfig: RC, evaluation: LOOSE,
            structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, amount: { type: { name: 'decimal' } } },
            comparison: { match: { keys: ['id'] }, fields: { amount: { tolerance: 0.1 } } } };
        const r = TV().compare(schema,
            { headers: ['id', 'amount'], rows: [['1', '2.00'], ['2', 2.95], ['3', '4.00']] },
            { headers: ['id', 'amount'], rows: [['1', 2.05], ['2', 3.00], ['3', '4.05']] });
        const cells = r.diff.rows.map((rd) => rd.cells.amount);
        assertEq(cells[0].exactFallback, 'binary64', 'row 0: text vs native → fallback');
        assertEq(typeof cells[0].delta, 'number', 'row 0: numeric delta (binary64 arithmetic)');
        assertEq(cells[1].exactFallback, 'binary64', 'row 1: native vs native → fallback');
        assertEq(typeof cells[1].delta, 'number', 'row 1: numeric delta');
        assertEq(cells[2].exactFallback, null, 'row 2: text vs text → evaluated exactly, no fallback');
        assertEq(cells[2].delta, '0.05', 'row 2: exact-decimal delta STRING (the §15.9 CellDiff typing note, exercised within one column\'s diffs)');
    });

    U('exportComparisonXlsx (§15.11, B112 precedent) — a decimal column\'s native-fallback pair carries [b64]; a text-text pair does not', async ({ assertEq }) => {
        const schema = { meta: META, resultConfig: RC, evaluation: LOOSE,
            structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, amount: { type: { name: 'decimal' } } },
            comparison: { match: { keys: ['id'] } } };
        const producedFB = { headers: ['id', 'amount'], rows: [['1', '2.53']] };
        const expectedFB = { headers: ['id', 'amount'], rows: [[1, 2.5]] };
        const rFB = TV().compare(schema, producedFB, expectedFB);
        const blobFB = await TV().exportComparisonXlsx({ result: rFB, table: producedFB, schema, expected: expectedFB });
        const wbFB = new window.ExcelJS.Workbook();
        await wbFB.xlsx.load(await blobFB.arrayBuffer());
        assertEq(wbFB.getWorksheet('Comparison').getRow(2).getCell(4).value, '✖ 2.53 ≠ 2.5 [b64]',
            'a decimal column needs no exact:true flag to earn the [b64] tag — the type itself is always exact');

        const producedTT = { headers: ['id', 'amount'], rows: [['1', '2.53']] };
        const expectedTT = { headers: ['id', 'amount'], rows: [['1', '2.50']] };
        const rTT = TV().compare(schema, producedTT, expectedTT);
        const blobTT = await TV().exportComparisonXlsx({ result: rTT, table: producedTT, schema, expected: expectedTT });
        const wbTT = new window.ExcelJS.Workbook();
        await wbTT.xlsx.load(await blobTT.arrayBuffer());
        assertEq(wbTT.getWorksheet('Comparison').getRow(2).getCell(4).value, '✖ 2.53 ≠ 2.50', 'a text-text exact pair carries no [b64]');
    }, { needsExcelJS: true });

    // ---------------- v1.6.0 P3: cross-cutting — determinism, self-accepting, JSON-safety, float byte-identity ----------------

    U('determinism — validate() and compare() run twice on decimal tables (ranges + sums + diffs) are deep-equal', ({ assert }) => {
        const rangeSchema = { meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'decimal', value: { min: null, max: 0.3, minInclusive: true, maxInclusive: true } } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: 1.00, expectedFieldRow: 'first', tolerance: 0 }] };
        const rangeTable = { headers: ['a'], rows: [['0.30000000000000000001'], ['0.10'], ['0.10']] };
        const v1 = TV().validate(rangeSchema, rangeTable);
        const v2 = TV().validate(rangeSchema, rangeTable);
        assert(JSON.stringify(v1) === JSON.stringify(v2), 'validate(): two runs over a ranges+sums decimal schema are byte-identical');

        const cmpSchema2 = { meta: META, resultConfig: RC, evaluation: LOOSE, structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, amount: { type: { name: 'decimal' } } },
            comparison: { match: { keys: ['id'] }, fields: { amount: { tolerance: 0.1 } } } };
        const p = { headers: ['id', 'amount'], rows: [['1', '2.13'], ['2', 2.95]] };
        const e = { headers: ['id', 'amount'], rows: [['1', '2.03'], ['2', '3.00']] };
        const c1 = TV().compare(cmpSchema2, p, e);
        const c2 = TV().compare(cmpSchema2, p, e);
        assert(JSON.stringify(c1) === JSON.stringify(c2), 'compare(): two runs over a decimal diffs schema are byte-identical');
    });

    U('self-accepting — a hand-authored decimal schema (formats + precision + value) validates a conforming table with zero violations; build() round-trip is idempotent and preserves the three decimal keys', ({ assert, assertEq }) => {
        const decSchema = { meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { amount: { type: { name: 'decimal',
                formats: [{ decimalSeparator: '.', groupingSeparators: [','] }],
                precision: { min: 2, max: 2, minInclusive: true, maxInclusive: true },
                value: { min: 0, max: 1000, minInclusive: true, maxInclusive: true } } } } };
        const table = { headers: ['amount'], rows: [['234.56'], ['0.00'], ['1,000.00']] };
        const v = TV().validate(decSchema, table);
        assert(v.valid && v.summary.bySeverity.error === 0, 'a conforming table produces zero violations');
        const b1 = TV().createConfigBuilder(decSchema).build();
        const b2 = TV().createConfigBuilder(b1).build();
        assertEq(b1, b2, 'build → rebuild is idempotent (canonical ordering, rule M7)');
        assertEq(Object.keys(b1.columns.amount.type).sort(), ['formats', 'name', 'precision', 'value'],
            'all three decimal-specific keys (formats, value, precision) survive the round-trip alongside name');
    });

    U('result JSON-safety — validate()/compare() results over decimal columns (incl. sumEquals) JSON.stringify cleanly: no BigInt leaks anywhere in the tree', ({ assert }) => {
        const noBigInt = (o) => {
            if (typeof o === 'bigint') return false;
            if (o === null || typeof o !== 'object') return true;
            return Object.keys(o).every((k) => noBigInt(o[k]));
        };
        const v = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'decimal', value: { min: 0, max: 1e17, minInclusive: true, maxInclusive: true } } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: 1.00, expectedFieldRow: 'first', tolerance: 0 }] },
            { headers: ['a'], rows: [['0.30000000000000000001'], ['0.10'], ['0.10']] });
        assert(noBigInt(v), 'validate() result carries no BigInt anywhere in its tree (the internal Dec arithmetic never escapes)');
        assert(!!JSON.stringify(v), 'validate() result JSON.stringify succeeds');

        const cmpSchema2 = { meta: META, resultConfig: RC, evaluation: LOOSE, structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, amount: { type: { name: 'decimal' } } },
            comparison: { match: { keys: ['id'] }, fields: { amount: { tolerance: 0.1 } } } };
        const c = TV().compare(cmpSchema2,
            { headers: ['id', 'amount'], rows: [['1', '2.13'], ['2', 9007199254740993]] },
            { headers: ['id', 'amount'], rows: [['1', '2.03'], ['2', '9007199254740992.00']] });
        assert(noBigInt(c), 'compare() result (incl. exact-decimal deltas/tolerances rendered as strings) carries no BigInt');
        assert(!!JSON.stringify(c), 'compare() result JSON.stringify succeeds');
    });

    // ---------------- non-finite numbers on the decimal surfaces (v1.6.0 P3.5) ----------------
    // JSON-inexpressible (only a programmatic host supplies NaN/±Infinity); before this round
    // each surface threw an uncaught SyntaxError from decFromNumber (§1.6 violation).

    U('§6.10 pinned exception — a native NaN/±Infinity cell on a decimal column is typeMismatch under strictType true AND false; float accepts it (additivity), no throw', ({ assert, assertEq }) => {
        for (const cell of [NaN, Infinity, -Infinity]) {
            for (const strict of [true, false]) {
                const dec = TV().validate({ meta: META, resultConfig: RC, evaluation: { strictType: strict, timezone: 'utc' },
                    columns: { a: { type: { name: 'decimal' } } } }, { headers: ['a'], rows: [[cell]] });
                assert(!dec.valid, `decimal rejects native ${String(cell)} (strictType ${strict})`);
                assertEq(dec.summary.details[0].ruleName, 'typeMismatch', `${String(cell)} is a typeMismatch (strictType ${strict}) — has no §1.5 decimal image`);
                const flt = TV().validate({ meta: META, resultConfig: RC, evaluation: { strictType: strict, timezone: 'utc' },
                    columns: { a: { type: { name: 'float' } } } }, { headers: ['a'], rows: [[cell]] });
                assert(flt.valid, `float still accepts native ${String(cell)} (strictType ${strict}) — the documented sibling divergence (additivity)`);
            }
        }
    });

    U('rule 60(a) — a decimal value bound of ±Infinity or NaN is schemaInvalid; the same Infinity bound on a float column stays legal (additivity)', ({ assertEq, assert }) => {
        const R = (b) => Object.assign({ min: null, max: null, minInclusive: true, maxInclusive: true }, b);
        const bad = (b) => run1({ name: 'decimal', value: R(b) }, ['1.5']);
        const maxInf = bad({ max: Infinity });
        assertEq(maxInf.abortReason, 'schemaInvalid', 'a non-finite max has no decimal image (rule 60)');
        assertEq(maxInf.summary.details[0].context.path, 'columns.a.type.value.max', 'the offending bound path');
        assertEq(maxInf.summary.details[0].context.expected, 'finite number or null', 'rule-60 message style');
        assertEq(bad({ min: -Infinity }).abortReason, 'schemaInvalid', '−Infinity min rejected too');
        assertEq(bad({ max: NaN }).abortReason, 'schemaInvalid', 'NaN bound rejected (already via isNum, kept)');
        const floatInf = run1({ name: 'float', value: R({ max: Infinity }) }, ['1.5']);
        assert(floatInf.valid, 'float bounds are binary64 — Infinity stays legal (additivity)');
    });

    U('rule 60(b) — conditionalRequired if.value ±Infinity on a decimal if.field is schemaInvalid; a float if.field keeps Infinity legal (additivity)', ({ assertEq, assert }) => {
        const schema = (tn, v) => ({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { amt: { type: { name: tn } }, note: { nullable: true, type: { name: 'string' } } },
            customRowChecks: [{ name: 'r', type: 'conditionalRequired', if: { field: 'amt', op: '>', value: v }, then: { field: 'note', nonNull: true } }] });
        const dec = TV().validate(schema('decimal', Infinity), { headers: ['amt', 'note'], rows: [['1.5', null]] });
        assertEq(dec.abortReason, 'schemaInvalid', 'a decimal if.field needs a finite literal (rule 60)');
        assertEq(dec.summary.details[0].context.path, 'customRowChecks[0].if.value', 'the offending path');
        const flt = TV().validate(schema('float', Infinity), { headers: ['amt', 'note'], rows: [['1.5', null]] });
        assert(flt.valid, 'a float if.field tolerates an Infinity literal (additivity)');
    });

    U('rule 60(c) — sumEquals in STATIC exact mode rejects non-finite expectedValue and tolerance; binary64-mode sumEquals keeps Infinity tolerance legal (always-pass, additivity of released garbage)', ({ assertEq, assert }) => {
        // exact:true (float) — expectedValue Infinity
        const ev = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE, columns: { a: { type: { name: 'float' } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: Infinity, tolerance: 0, exact: true }] },
            { headers: ['a'], rows: [['1.0']] });
        assertEq(ev.abortReason, 'schemaInvalid', 'exact:true + non-finite expectedValue → rule 60');
        assertEq(ev.summary.details[0].context.path, 'customTableChecks[0].expectedValue', 'expectedValue path');
        // decimal reference (auto-exact) — tolerance Infinity
        const tol = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE, columns: { a: { type: { name: 'decimal' } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: 1.00, tolerance: Infinity }] },
            { headers: ['a'], rows: [['1.00']] });
        assertEq(tol.abortReason, 'schemaInvalid', 'decimal-triggered exact mode + Infinity tolerance → rule 60 (was a silent decParse(0) coercion — incoherent)');
        assertEq(tol.summary.details[0].context.path, 'customTableChecks[0].tolerance', 'tolerance path');
        // binary64-mode control: no exact, no decimal → Infinity tolerance is legal and always passes
        const b64 = TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE, columns: { a: { type: { name: 'float' } } },
            customTableChecks: [{ name: 's', type: 'sumEquals', fields: ['a'], expectedValue: 1.00, tolerance: Infinity }] },
            { headers: ['a'], rows: [['999.0']] });
        assert(b64.valid, 'binary64-mode sumEquals: Infinity tolerance stays legal → always passes (unchanged released semantics)');
    });

    U('§7.1 mixed pin — a built-in comparison of a decimal field vs a float field with a non-finite native float cell evaluates in binary64 (NaN: ordered/== false, != true; infinities order normally), no crash', ({ assert }) => {
        const mixed = (op, bcell) => TV().validate({ meta: META, resultConfig: RC, evaluation: LOOSE,
            columns: { a: { type: { name: 'decimal' } }, b: { type: { name: 'float' } } },
            customRowChecks: [{ name: 'ab', type: 'comparison', fieldA: 'a', fieldB: 'b', op }] },
            { headers: ['a', 'b'], rows: [['2.03', bcell]] });
        for (const op of ['<', '<=', '==', '>=', '>']) {
            assert(!mixed(op, NaN).valid, `decimal 2.03 ${op} float NaN is false (binary64 NaN comparison) → violation`);
        }
        assert(mixed('!=', NaN).valid, 'decimal 2.03 != float NaN is true (the sole NaN-true operator) → no violation');
        assert(mixed('<', Infinity).valid, '2.03 < +Infinity orders normally (true)');
        assert(mixed('>', -Infinity).valid, '2.03 > −Infinity orders normally (true)');
        assert(!mixed('>', Infinity).valid, '2.03 > +Infinity is false → violation');
    });

    U('§15.8 — compare() exact:true (float) AND a decimal column both evaluate a tolerance-Infinity pair as toleranceMatch with numeric delta/tolerance + exactFallback "binary64" (a 1.5.x crash, corrected)', ({ assertEq }) => {
        const check = (tn, extraFields) => {
            const schema = { meta: META, resultConfig: RC, evaluation: LOOSE, structure: { columnMatching: 'byName' },
                columns: { id: { type: { name: 'int' } }, amount: { type: { name: tn } } },
                comparison: { match: { keys: ['id'] }, fields: { amount: Object.assign({ tolerance: Infinity }, extraFields) } } };
            const r = TV().compare(schema, { headers: ['id', 'amount'], rows: [['1', '1.5']] }, { headers: ['id', 'amount'], rows: [['1', '9.9']] });
            const cd = r.diff.rows[0].cells.amount;
            assertEq(r.aborted, false, `${tn}: no abort (was SyntaxError in 1.5.x)`);
            assertEq(cd.tier, 'toleranceMatch', `${tn}: |Δ| ≤ +Infinity → within tolerance`);
            assertEq(typeof cd.delta, 'number', `${tn}: binary64 numeric delta`);
            assertEq(cd.tolerance, Infinity, `${tn}: tolerance recorded as the binary64 number`);
            assertEq(cd.exactFallback, 'binary64', `${tn}: pair discloses the binary64 fallback`);
        };
        check('float', { exact: true });   // float exact:true opt-in surface (retro-covered from 1.5.0)
        check('decimal', {});              // decimal column is always exact (no flag — rule C4)
    });

    U('§15.8 — a NaN resolved ε classifies no pair within tolerance: a field-form ε driven by a NaN native cell is a valueMismatch with exactFallback "binary64" (no crash); a fn returning NaN is the pre-existing ε-contract violation; a fn returning +Infinity is a fallback toleranceMatch', ({ assertEq }) => {
        // field-form ε driven by a NaN native cell → NaN ε → valueMismatch, disclosed as binary64
        const fieldSchema = { meta: META, resultConfig: RC, evaluation: LOOSE, structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, tol: { type: { name: 'float' } }, amount: { type: { name: 'float' } } },
            comparison: { match: { keys: ['id'] }, fields: { amount: { exact: true, tolerance: { field: 'tol', from: 'expected' } } } } };
        const fr = TV().compare(fieldSchema, { headers: ['id', 'tol', 'amount'], rows: [['1', '0', '1.5']] },
            { headers: ['id', 'tol', 'amount'], rows: [['1', NaN, '9.9']] });
        const fc = fr.diff.rows[0].cells.amount;
        assertEq(fr.aborted, false, 'NaN ε does not crash');
        assertEq(fc.tier, 'valueMismatch', 'a NaN ε classifies no pair as within tolerance');
        assertEq(fc.exactFallback, 'binary64', 'the pair is disclosed as a binary64 fallback');
        // fn ε: +Infinity → fallback toleranceMatch; NaN → the ε contract rejects it (isNum excludes NaN)
        const fnSchema = { meta: META, resultConfig: RC, evaluation: LOOSE, structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, amount: { type: { name: 'float' } } },
            comparison: { match: { keys: ['id'] }, fields: { amount: { exact: true, tolerance: { fn: 'f' } } } } };
        const inf = TV().compare(fnSchema, { headers: ['id', 'amount'], rows: [['1', '1.5']] },
            { headers: ['id', 'amount'], rows: [['1', '9.9']] }, { functions: { f: () => Infinity } });
        const ic = inf.diff.rows[0].cells.amount;
        assertEq(ic.tier, 'toleranceMatch', 'fn +Infinity ε → within tolerance (binary64 fallback)');
        assertEq(ic.exactFallback, 'binary64', 'disclosed as a fallback');
        const nan = TV().compare(fnSchema, { headers: ['id', 'amount'], rows: [['1', '1.5']] },
            { headers: ['id', 'amount'], rows: [['1', '9.9']] }, { functions: { f: () => NaN } });
        assertEq(nan.abortReason, 'customFunctionContractViolation', 'fn NaN is rejected by the ε contract → no pair within tolerance');
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

    // Frozen baselines (recorded 1.6.0 P3, run against the current engine) for the float
    // byte-identity sweep below — each is copied VERBATIM from a real run of an EXISTING
    // float vector's schema+table, one per shape (ranges / sumEquals / compare-tolerance).
    // specVersion is read live (a version bump alone must not flip this vector); every
    // other field is a hardcoded literal, so ANY change to float value-range arithmetic,
    // binary64 sumEquals accumulation, float compare()-tolerance arithmetic, message text,
    // or context/CellDiff shape flips it — proving decimal's presence changed nothing float-side.
    const RANGES_BASELINE = () => ({
        specVersion: TV().SPEC_VERSION, valid: false, validWithWarnings: false, aborted: false, abortReason: null,
        truncated: false, truncationReason: null,
        summary: {
            rowsChecked: 2, columnsChecked: 1, bySeverity: { error: 1, warning: 0 },
            byPhase: { schemaValidation: 0, schemaResolution: 0, structuralColumnChecks: 0, structuralRowChecks: 0,
                cellValidation: 1, columnAggregateChecks: 0, rowCrossColumnChecks: 0, tableChecks: 0,
                structuralComparison: 0, cellComparison: 0, comparisonChecks: 0 },
            byColumn: { a: { error: 1, warning: 0 } }, truncatedColumns: [],
            details: [{
                severity: 'error', phase: 'cellValidation', ruleName: 'rangeBreach', fieldName: 'a',
                message: 'value out of range 0–10',
                context: { constraint: 'value', min: 0, max: 10, minInclusive: true, maxInclusive: false },
                count: 1, firstOccurrenceRow: 0, topSampleValues: [{ value: '10', frequency: 1 }], topSampleRows: [0],
            }],
            columnMatching: 'byName',
        },
        cellRegister: [{ row: 0, field: 'a', severity: 'error', ruleName: 'rangeBreach', value: '10',
            message: 'value out of range 0–10',
            context: { constraint: 'value', min: 0, max: 10, minInclusive: true, maxInclusive: false } }],
        cellObservations: null,
    });
    const SUM_BASELINE = () => ({
        specVersion: TV().SPEC_VERSION, valid: true, validWithWarnings: false, aborted: false, abortReason: null,
        truncated: false, truncationReason: null,
        summary: {
            rowsChecked: 2, columnsChecked: 2, bySeverity: { error: 0, warning: 0 },
            byPhase: { schemaValidation: 0, schemaResolution: 0, structuralColumnChecks: 0, structuralRowChecks: 0,
                cellValidation: 0, columnAggregateChecks: 0, rowCrossColumnChecks: 0, tableChecks: 0,
                structuralComparison: 0, cellComparison: 0, comparisonChecks: 0 },
            byColumn: {}, truncatedColumns: [], details: [], columnMatching: 'byName',
        },
        cellRegister: [], cellObservations: null,
    });
    const CMP_BASELINE = () => ({
        specVersion: TV().SPEC_VERSION, valid: true, validWithWarnings: true, aborted: false, abortReason: null,
        truncated: false, truncationReason: null,
        summary: {
            rowsChecked: 1, columnsChecked: 3, bySeverity: { error: 0, warning: 1 },
            byPhase: { schemaValidation: 0, schemaResolution: 0, structuralColumnChecks: 0, structuralRowChecks: 0,
                cellValidation: 0, columnAggregateChecks: 0, rowCrossColumnChecks: 0, tableChecks: 0,
                structuralComparison: 0, cellComparison: 1, comparisonChecks: 0 },
            byColumn: { amount: { error: 0, warning: 1 } }, truncatedColumns: [],
            details: [{
                severity: 'warning', phase: 'cellComparison', ruleName: 'toleranceMatch', fieldName: 'amount',
                message: 'amount: within tolerance (Δ 0.020000000000000018 ≤ 0.05)',
                context: { field: 'amount', matchKey: [['n', 1]], inScope: true, matchStatus: 'matched',
                    rollup: 'equivalent', tier: 'toleranceMatch', expected: '1.00', produced: '1.02',
                    delta: 0.020000000000000018, tolerance: 0.05, toleranceSource: 'absolute', similarity: undefined },
                count: 1, firstOccurrenceRow: 0, topSampleValues: [{ value: '1.02', frequency: 1 }], topSampleRows: [0],
            }],
            rowsProduced: 1, rowsExpected: 1, rowsMatched: 1, rowsMissing: 0, rowsUnexpected: 0, rowsExcluded: 0,
        },
        cellRegister: [{ row: 0, field: 'amount', severity: 'warning', ruleName: 'toleranceMatch', value: '1.02',
            message: 'amount: within tolerance (Δ 0.020000000000000018 ≤ 0.05)',
            context: { field: 'amount', matchKey: [['n', 1]], inScope: true, matchStatus: 'matched',
                rollup: 'equivalent', tier: 'toleranceMatch', expected: '1.00', produced: '1.02',
                delta: 0.020000000000000018, tolerance: 0.05, toleranceSource: 'absolute', similarity: undefined } }],
        cellObservations: null, engine: 'compare',
        diff: {
            rows: [{
                matchKey: [['n', 1]], status: 'matched', inScope: true, similarity: null, producedRow: 0, expectedRow: 0,
                cells: {
                    id: { rollup: 'equal', tier: 'exact', produced: '1', expected: '1', producedInterpreted: 1,
                        expectedInterpreted: 1, delta: null, tolerance: null, similarity: null, exactFallback: null },
                    name: { rollup: 'equal', tier: 'exact', produced: 'x', expected: 'x', producedInterpreted: 'x',
                        expectedInterpreted: 'x', delta: null, tolerance: null, similarity: null, exactFallback: null },
                    amount: { rollup: 'equivalent', tier: 'toleranceMatch', produced: '1.02', expected: '1.00',
                        producedInterpreted: 1.02, expectedInterpreted: 1, delta: 0.020000000000000018,
                        tolerance: 0.05, similarity: null, exactFallback: null },
                },
                checkFails: [],
            }],
            tableCheckFails: [],
            summary: { comparedCells: 3, differentCells: 0, equivalentCells: 1, orphanRateExpected: 0, orphanRateProduced: 0 },
        },
    });

    U('float byte-identity sweep — three EXISTING float vectors (a ranges one, a sumEquals one, a compare-tolerance one) reproduce their pre-recorded baselines exactly', ({ assertEq }) => {
        // Pick 1 — ranges: cell.js "B098: float column maxInclusive:false rejects the value exactly at max; a value just below passes"
        const rangesResult = TV().validate({
            meta: { schemaVersion: '1.0.0', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            columns: { a: { type: { name: 'float', value: { min: 0, max: 10, minInclusive: true, maxInclusive: false } } } },
        }, { headers: ['a'], rows: [['10'], ['9.99']] });
        assertEq(rangesResult, RANGES_BASELINE(), 'ranges baseline — flips on any change to float value-range arithmetic, message text, or context shape');

        // Pick 2 — sumEquals: table-checks.js "sumEquals — nulls count as 0; expectedField \'last\'; tolerance absorbs drift"
        const sumResult = TV().validate({
            meta: { schemaVersion: '1.0.0', name: 't' }, resultConfig: RC,
            evaluation: { strictType: false, timezone: 'utc' },
            nullHandling: { nullEquivalents: [''] },
            columns: { x: { nullable: true, type: { name: 'float' } }, total: { nullable: true, type: { name: 'float' } } },
            customTableChecks: [{ name: 'sum', type: 'sumEquals', fields: ['x'],
                expectedValue: null, expectedField: 'total', expectedFieldRow: 'last', tolerance: 0.5 }],
        }, { headers: ['x', 'total'], rows: [['1.2', ''], [null, '1.0']] });
        assertEq(sumResult, SUM_BASELINE(),
            'sumEquals baseline (binary64, null-as-0, tolerance-absorbs-drift path) — flips on any change to non-exact sumEquals arithmetic that the decimal exact-mode trigger check could have disturbed');

        // Pick 3 — compare-tolerance: comparison.js "compare — toleranceMatch: within tolerance, not interpreted-equal"
        const cmpResult = TV().compare({
            meta: { schemaVersion: '1.0.0', name: 'cmp' }, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' }, structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, name: { type: { name: 'string' } }, amount: { type: { name: 'float' } } },
            comparison: { match: { keys: ['id'] }, fields: { amount: { tolerance: 0.05 } },
                severity: { toleranceMatch: 'warning', valueMismatch: 'error' } },
        }, { headers: ['id', 'name', 'amount'], rows: [['1', 'x', '1.02']] },
           { headers: ['id', 'name', 'amount'], rows: [['1', 'x', '1.00']] });
        assertEq(cmpResult, CMP_BASELINE(),
            'compare-tolerance baseline (float, binary64 Δ/ε, no exact flag) — flips on any change to float compare() tolerance arithmetic or CellDiff shape');
    });
})();
