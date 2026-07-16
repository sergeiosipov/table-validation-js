/* Inference module — inferConfig() (Addendum §C, JS spec §3.13). */
'use strict';
(function () {
    const U = window.__UNIT__;
    const suite = 'infer';
    const TV = () => window.TableValidation;
    const rows = (n, f) => Array.from({ length: n }, (_, i) => f(i));

    // Every draft must pass Phase 1 by construction (rule N1) — checked through both
    // the builder and a real engine run.
    function assertN1(assert, draft, label) {
        const a = TV().createConfigBuilder(draft).validate();
        assert(a.valid, `${label}: draft passes authoring validation (N1); errors: ${JSON.stringify(a.errors)}`);
    }

    U.push({
        suite, name: 'ladder: bool / int / float / formatted number / categorical / string',
        fn: ({ assert, assertEq }) => {
            const t = {
                headers: ['flag', 'id', 'ratio', 'de', 'cat', 'txt'],
                rows: rows(30, (i) => [
                    i % 2 ? 'yes' : 'NO',
                    String(i + 1),
                    (i + 1) + '.5',
                    '1.234,' + String(10 + i),         // de-style grouping+decimal
                    i % 3 === 0 ? 'A' : 'B',
                    'free text ' + i,
                ]),
            };
            const { draft, report } = TV().inferConfig(t);
            const types = {};
            for (const c of report.columns) types[c.name] = c.inferredType;
            assertEq(types, { flag: 'bool', id: 'int', ratio: 'float', de: 'float', cat: 'categorical', txt: 'string' }, 'ladder types');
            assertEq(draft.columns.de.type.formats, [{ decimalSeparator: ',', groupingSeparators: ['.'] }],
                'winning NumberFormat drafted');
            assertEq(draft.columns.cat.type.allowedValues, ['A', 'B'], 'categorical values sorted by code point');
            assertEq(draft.evaluation.strictType, false, 'string interpretation forced strictType false');
            assert(report.columns.find((c) => c.name === 'id').observed.reliedOnInterpretation, 'relied flag set');
            assertEq(draft.structure.columnCount, { min: 6, max: 6, minInclusive: true, maxInclusive: true }, 'columnCount pinned');
            assertN1(assert, draft, 'ladder');
            const run = TV().validate(draft, t);
            assert(run.valid, 'the draft validates its own sample cleanly');
        },
    });

    U.push({
        suite, name: 'conservatism: "0"/"1"-only columns are int with a ranked bool alternative; dotted dates are not numbers',
        fn: ({ assert, assertEq }) => {
            const { report } = TV().inferConfig({
                headers: ['bin', 'dotted'],
                rows: rows(25, (i) => [i % 2 ? '1' : '0', '0' + (i % 9 + 1) + '.07.2026']),
            });
            const bin = report.columns[0];
            assertEq(bin.inferredType, 'int', 'numeric-only bool tokens do NOT infer bool');
            assertEq(bin.confidence, 'ambiguous', 'tie-break is reported');
            assertEq(bin.alternatives, [{ type: 'bool', formats: null, rank: 1 }], 'bool reading is the ranked alternative');
            const dotted = report.columns[1];
            assert(dotted.inferredType !== 'int' && dotted.inferredType !== 'float',
                'well-formed-grouping guard: "01.07.2026" is not a formatted number');
        },
    });

    U.push({
        suite, name: 'temporal inference: winner + format, ambiguity policy (dd/MM vs MM/dd)',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            const t = {
                headers: ['day', 'stamp', 'ambig'],
                rows: rows(20, (i) => [
                    '1' + (i % 9) + '.07.2026',                               // dd.MM.yyyy (days 10..18)
                    '2026-07-' + String(10 + (i % 9)) + 'T0' + (i % 9) + ':30:00',
                    '0' + (i % 9 + 1) + '/0' + ((i + 3) % 9 + 1) + '/2026',   // both dd/MM and MM/dd accept
                ]),
            };
            const { draft, report } = TV().inferConfig(t);
            assertEq(report.columns[0].inferredType, 'date', 'dd.MM.yyyy → date');
            assertEq(draft.columns.day.type, { name: 'date', formats: ['dd.MM.yyyy'] }, 'winning format drafted');
            assertEq(report.columns[0].confidence, 'high', 'single surviving format → high');
            assertEq(report.columns[1].inferredType, 'datetime', 'ISO stamp → datetime');
            const amb = report.columns[2];
            assertEq(amb.inferredType, 'date', 'ambiguous column still infers the candidate-order winner');
            assertEq(amb.confidence, 'ambiguous', 'confidence drops');
            assertEq(amb.reasons, ['multipleTemporalFormats'], 'reason recorded');
            assertEq(draft.columns.ambig.type.formats, ['dd/MM/yyyy'], 'draft carries the winner only');
            assertEq(amb.alternatives, [{ type: 'date', formats: ['MM/dd/yyyy'], rank: 1 }], 'alternatives ranked in table order');
            assert(report.columns[0].observed.min === '10.07.2026', 'temporal min reported as the original extreme string');
            assertN1(assert, draft, 'temporal');
            const run = TV().validate(draft, t);
            assert(run.valid, 'draft validates the sample (whole-string strict parse still governs)');
        },
    });

    U.push({
        suite, name: 'allAcceptingFormats: draft carries every accepting candidate; mixed-format columns validate',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            // ambiguous single-format column: with the option, BOTH accepting formats are drafted
            const ambig = {
                headers: ['d'],
                rows: rows(20, (i) => ['0' + (i % 9 + 1) + '/0' + ((i + 3) % 9 + 1) + '/2026']),
            };
            const on = TV().inferConfig(ambig, { allAcceptingFormats: true });
            assertEq(on.draft.columns.d.type.formats, ['dd/MM/yyyy', 'MM/dd/yyyy'],
                'winner first, remaining accepting candidates in table order');
            assertEq(on.report.columns[0].confidence, 'ambiguous', 'confidence still drops');
            assertN1(assert, on.draft, 'allAccepting-ambig');
            // genuinely mixed-format column: no single candidate accepts everything, but the
            // union does → temporal via union coverage (default would fall through to string)
            const mixed = {
                headers: ['d'],
                rows: [['2026-07-15'], ['16.07.2026'], ['2026-07-17'], ['18.07.2026']],
            };
            const off = TV().inferConfig(mixed);
            assertEq(off.report.columns[0].inferredType, 'string', 'default: mixed formats fall through');
            const onMixed = TV().inferConfig(mixed, { allAcceptingFormats: true });
            assertEq(onMixed.report.columns[0].inferredType, 'date', 'union coverage infers date');
            assertEq(onMixed.draft.columns.d.type.formats, ['yyyy-MM-dd', 'dd.MM.yyyy'],
                'winner = most-accepting (tie → table order), then remaining used candidates');
            assertEq(onMixed.report.columns[0].reasons, ['mixedTemporalFormats'], 'reason recorded');
            assertEq(onMixed.report.columns[0].confidence, 'ambiguous', 'never silently confident');
            assertN1(assert, onMixed.draft, 'allAccepting-mixed');
            // the point of the feature: the mixed column validates without hand-editing
            const run = TV().validate(onMixed.draft, mixed);
            assert(run.valid, 'mixed-format date column validates with the multi-format draft');
            // determinism with the option on
            assert(JSON.stringify(TV().inferConfig(mixed, { allAcceptingFormats: true })) === JSON.stringify(onMixed),
                'deterministic');
        },
    });

    U.push({
        suite, name: 'allAcceptingFormats: numeric union coverage for mixed NumberFormat columns (§C.4 point 3)',
        fn: ({ assert, assertEq }) => {
            // no single candidate accepts BOTH spellings, but fmt0 (US .,) and fmt1 (EU ,.)
            // jointly cover them — 2 participants each → most-accepting tie → table order wins
            const mixed = { headers: ['amt'], rows: [['1,234.50'], ['1.234,50'], ['9,999.00'], ['8.888,00']] };
            // option OFF → string fallback, exactly as today
            const off = TV().inferConfig(mixed);
            assertEq(off.report.columns[0].inferredType, 'string', 'default: mixed NumberFormats fall through to string');
            assertEq(off.draft.columns.amt.type, { name: 'string' }, 'no formats drafted without the option');
            // option ON → float via union coverage
            const on = TV().inferConfig(mixed, { allAcceptingFormats: true });
            const c = on.report.columns[0];
            assertEq(c.inferredType, 'float', 'union coverage infers float (a participant carries a fractional part)');
            assertEq(c.confidence, 'ambiguous', 'union coverage is ambiguous');
            assertEq(c.reasons, ['mixedNumberFormats'], 'reason literal recorded');
            assertEq(on.draft.columns.amt.type.formats,
                [{ decimalSeparator: '.', groupingSeparators: [','] }, { decimalSeparator: ',', groupingSeparators: ['.'] }],
                'winner (most-accepting; tie → table order) first, then remaining reduced candidates in table order');
            assertEq(c.alternatives, [{ type: 'float', formats: [{ decimalSeparator: ',', groupingSeparators: ['.'] }], rank: 1 }],
                'non-winning reduced formats are ranked alternatives');
            // reduction: allowBareDecimal / negativeStyle generalizations that accept exactly
            // the same participants as their strict twin are dropped (strict precedes twin)
            assert(on.draft.columns.amt.type.formats.every((f) => f.allowBareDecimal === undefined && f.negativeStyle === undefined),
                'reduction drops generalizations whose strict twin accepts the same participants');
            // self-accepting invariant (§C.1): the multi-format draft validates its own sample
            assertN1(assert, on.draft, 'numeric-union');
            const run = TV().validate(on.draft, mixed);
            assert(run.valid, 'mixed-format numeric column validates with the union-formats draft');
            // an allowBareDecimal generalization is genuinely dropped when its strict twin
            // covers the same participants: a bare participant (.85) is needed to keep one
            const withBare = { headers: ['amt'], rows: [['1,234.50'], ['1.234,50'], ['.85']] };
            const wb = TV().inferConfig(withBare, { allAcceptingFormats: true });
            assert(wb.draft.columns.amt.type.formats.some((f) => f.allowBareDecimal === true),
                'a bare-decimal participant keeps exactly the bare candidate that alone accepts it');
            assertN1(assert, wb.draft, 'numeric-union-bare');
            assert(TV().validate(wb.draft, withBare).valid, 'bare-inclusive union draft validates its sample');
            // determinism
            assert(JSON.stringify(TV().inferConfig(mixed, { allAcceptingFormats: true })) === JSON.stringify(on), 'deterministic');
        },
    });

    U.push({
        suite, name: 'report-only pattern suggestions (§C.7): unanimous k + all-or-none grouping; never drafted',
        fn: ({ assert, assertEq }) => {
            // money column: constant 2 decimals, no grouping → step-3 float → '0.00'
            const money = { headers: ['amt'], rows: rows(6, (i) => [(i + 1) + '.00']) };
            const m = TV().inferConfig(money);
            assertEq(m.report.suggestions.patterns,
                [{ column: 'amt', suggested: '0.00', basis: 'decimals:2,participants:6' }],
                'constant 2-decimal ungrouped float → 0.00 with the winner decimal separator');
            assertEq(m.draft.columns.amt.type.pattern, undefined, 'pattern is NEVER drafted');
            // grouped column: step-4 float, winner ., group , → #,##0.00
            const grouped = { headers: ['amt'], rows: [['1,234.50'], ['2,000.00'], ['9,876.25']] };
            const g = TV().inferConfig(grouped);
            assertEq(g.report.columns[0].inferredType, 'float', 'grouped decimals infer float via step 4');
            assertEq(g.report.suggestions.patterns,
                [{ column: 'amt', suggested: '#,##0.00', basis: 'decimals:2,grouping:3,participants:3' }],
                'unanimous grouping + 2 decimals → #,##0.00 with the winner separators');
            assertEq(g.draft.columns.amt.type.pattern, undefined, 'grouped draft carries no pattern');
            // varying decimal-digit count → NO suggestion (a pattern any participant violates
            // must never be suggested)
            const varK = { headers: ['amt'], rows: [['1.5'], ['2.50'], ['3.125']] };
            assertEq(TV().inferConfig(varK).report.suggestions.patterns, [], 'varying k → no suggestion');
            // partial grouping (one grouped, one not) → NO suggestion
            const partial = { headers: ['amt'], rows: [['1,234.50'], ['999.00']] };
            assertEq(TV().inferConfig(partial).report.suggestions.patterns, [], 'partial grouping → no suggestion');
        },
    });

    U.push({
        suite, name: 'null recognition: fixed candidate tokens adopted on observation; nullability',
        fn: ({ assert, assertEq }) => {
            const { draft, report } = TV().inferConfig({
                headers: ['a', 'b'],
                rows: [['1', 'x'], ['NA', 'y'], ['3', ''], ['4', 'z']],
            });
            assertEq(draft.nullHandling.nullEquivalents, ['', 'NA'], '"" first, then adopted tokens in candidate order');
            assertEq(report.columns[0].observed.nullTokensSeen, { NA: 1 }, 'token occurrences reported');
            assertEq(draft.columns.a, { nullable: true, type: { name: 'int' } }, 'NA did not break int; column nullable');
            assertEq(draft.columns.b.nullable, true, '"" is intrinsically null');
            assertEq(report.columns[0].candidateKey, false, 'null-holding column is no key candidate');
            // unadopted tokens are NOT suggested
            const clean = TV().inferConfig({ headers: ['c'], rows: [['1'], ['2']] });
            assertEq(clean.draft.nullHandling.nullEquivalents, [''], 'only "" without observed tokens');
            assertEq(clean.report.columns[0].sampleDerivedNullability, true, 'nullable:false flagged as sample-derived');
            assertN1(assert, draft, 'nulls');
        },
    });

    U.push({
        suite, name: 'candidate keys reported (never drafted); comparison seeding opt-in',
        fn: ({ assert, assertEq }) => {
            const t = { headers: ['id', 'dup'], rows: [['1', 'x'], ['2', 'x'], ['3', 'y']] };
            const plain = TV().inferConfig(t);
            assertEq(plain.report.candidateKeys, ['id'], 'distinct, null-free column is a candidate');
            assertEq(plain.draft.columns.id.unique, undefined, 'uniqueness is never baked into the draft');
            assertEq(plain.draft.comparison, undefined, 'no seeding by default');
            const seeded = TV().inferConfig(t, { seedComparison: true });
            assertEq(seeded.draft.comparison, { match: { keys: ['id'] } }, 'minimal valid comparison seed (rule C1)');
            assertN1(assert, seeded.draft, 'seeded');
            const noKey = TV().inferConfig({ headers: ['dup'], rows: [['x'], ['x']] }, { seedComparison: true });
            assertEq(noKey.draft.comparison, undefined, 'no candidate key → no seed');
            assertEq(noKey.report.noSingleColumnKey, true, 'reported why');
        },
    });

    U.push({
        suite, name: 'sampling bound, determinism, headerless/byPosition drafts (rule N6)',
        fn: ({ assert, assertEq }) => {
            const t = { headers: null, rows: rows(50, (i) => [String(i), 'x']) };
            const a = TV().inferConfig(t, { sampleRows: 10 });
            const b = TV().inferConfig(t, { sampleRows: 10 });
            assert(JSON.stringify(a) === JSON.stringify(b), 'deterministic across runs');
            assertEq(a.report.sample, { rowsAvailable: 50, rowsSampled: 10, exhaustive: false }, 'bounded prefix sample');
            assertEq(a.draft.structure.columnMatching, 'byPosition', 'headerless → byPosition');
            assertEq(Object.keys(a.draft.columns), ['col_0', 'col_1'], 'positional logical names');
            assertEq(a.draft.columns.col_0.required, undefined, 'N6: required never emitted');
            assertN1(assert, a.draft, 'byPosition');
            // headers unusable (collision under default fieldNameMatching) → byPosition fallback
            const c = TV().inferConfig({ headers: ['A', 'a'], rows: [['1', '2']] });
            assertEq(c.draft.structure.columnMatching, 'byPosition', 'colliding headers fall back');
            assert(c.report.limitations.includes('headersUnusable:byPosition'), 'fallback reported');
            assertN1(assert, c.draft, 'fallback');
        },
    });

    U.push({
        suite, name: 'suggestRanges (observed bounds) and report-only tolerance suggestions',
        fn: ({ assert, assertEq }) => {
            const t = { headers: ['v'], rows: rows(10, (i) => [(i + 1) + '.25']) };
            const off = TV().inferConfig(t);
            assertEq(off.draft.columns.v.type.value, undefined, 'ranges off by default');
            assertEq(off.report.suggestions.tolerances, [{ column: 'v', suggested: 0.005, basis: 'observedPrecision:2' }],
                'tolerance suggestion is report-only');
            const on = TV().inferConfig(t, { suggestRanges: true });
            assertEq(on.draft.columns.v.type.value, { min: 1.25, max: 10.25, minInclusive: true, maxInclusive: true },
                'observed bounds exactly, no widening');
            assertEq(on.draft.columns.v.type.precision, { min: 2, max: 2, minInclusive: true, maxInclusive: true },
                'observed precision range');
            assertN1(assert, on.draft, 'ranges');
        },
    });

    U.push({
        suite, name: 'fallbacks: allNull, mixedNativeKinds; caller errors thrown (N2/N3)',
        fn: ({ assert, assertEq, assertThrows }) => {
            const { draft, report } = TV().inferConfig({
                headers: ['empty', 'mixed'],
                rows: [[null, 1], ['', true], ['NA', 'x']],
            });
            assertEq(report.columns[0].confidence, 'fallback', 'allNull → fallback');
            assertEq(report.columns[0].reasons, ['allNull'], 'reason');
            assertEq(draft.columns.empty, { nullable: true, type: { name: 'string' } }, 'allNull drafts nullable string');
            assertEq(report.columns[1].confidence, 'fallback', 'mixed native kinds → fallback');
            assertEq(report.columns[1].reasons, ['mixedNativeKinds'], 'reason');
            assertEq(draft.columns.mixed.type.name, 'string', 'mixed kinds draft as string');
            assertN1(assert, draft, 'fallbacks');
            assertThrows(() => TV().inferConfig({ rows: 'nope' }), 'TableValidationConfigError', 'bad table');
            assertThrows(() => TV().inferConfig({ headers: null, rows: [[1]] }, { sampleRows: 0 }),
                'TableValidationConfigError', 'N2: sampleRows >= 1');
            assertThrows(() => TV().inferConfig({ headers: null, rows: [[1]] }, { name: '' }),
                'TableValidationConfigError', 'N3: non-empty name');
        },
    });

    U.push({
        suite, name: 'ingest → infer → author → run: the tooling flow end to end',
        fn: async ({ assert, assertEq }) => {
            const csv = 'id,amount,day\n1,"1.234,50",01.07.2026\n2,"2.000,00",02.07.2026\n3,,03.07.2026\n';
            const { table } = await TV().ingest(csv, { format: 'csv' });
            const { draft, report } = TV().inferConfig(table, { name: 'deliveries' });
            assertEq(draft.meta.name, 'deliveries', 'options.name lands in meta.name');
            assertEq(report.candidateKeys[0], 'id', 'id is the first candidate key');
            const b = TV().createConfigBuilder(draft)
                .set('columns.id.unique.enabled', true)
                .set('resultConfig.collectCellRegister', true);
            const authoring = b.validate();
            assert(authoring.valid, `authoring valid; ${JSON.stringify(authoring.errors)}`);
            const result = TV().validate(b.build(), table);
            assert(result.valid, 'clean sample validates');
            assertEq(result.specVersion, TV().SPEC_VERSION, 'result stamps the unified version');
        },
    });

    // ---------------- v1.1.0: real-world dates & float precision ----------------

    U.push({
        suite, name: 'unpadded d/M tokens (1.1.0): d.M.yyyy infers high-confidence; padded columns unchanged',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            // mixed padded/unpadded: only the unpadded twin accepts everything -> sole
            // accepter after twin reduction (d.M.yyyy, no alternatives). Since 1.5.0 the month
            // rendering mixes '7'/'07'/'12', so the mixedPadding signal (§C.4) fires: confidence
            // drops to ambiguous with reason mixedPadding, the draft stays byte-identical.
            const mixed = { headers: ['d'], rows: [['1.7.2026'], ['15.07.2026'], ['3.12.2026']] };
            const r = TV().inferConfig(mixed);
            assertEq(r.report.columns[0].inferredType, 'date', 'unpadded column infers date');
            assertEq(r.draft.columns.d.type.formats, ['d.M.yyyy'], 'unpadded format drafted (sole accepter after reduction)');
            assertEq(r.report.columns[0].confidence, 'ambiguous', 'mixed padded/unpadded month → mixedPadding (1.5.0)');
            assertEq(r.report.columns[0].reasons, ['mixedPadding'], 'the sole reason is mixedPadding (no temporal ambiguity here)');
            assertEq(r.report.columns[0].alternatives, [], 'mixedPadding adds no alternative');
            assertEq(r.report.columns[0].observed.paddingStyle,
                { day: { padded: 0, unpadded: 2, neutral: 1 }, month: { padded: 1, unpadded: 1, neutral: 1 } },
                'per-component evidence: day never padded, month is the mixed component');
            assertN1(assert, r.draft, 'unpadded');
            assert(TV().validate(r.draft, mixed).valid, 'the draft validates its own sample');
            // all-padded column: byte-identical to 1.0.0 -- padded winner, high, no
            // unpadded twin leaking in as an alternative
            const padded = { headers: ['d'], rows: [['15.07.2026'], ['03.12.2026']] };
            const rp = TV().inferConfig(padded);
            assertEq(rp.draft.columns.d.type.formats, ['dd.MM.yyyy'], 'padded winner unchanged');
            assertEq(rp.report.columns[0].confidence, 'high', 'still high');
            assertEq(rp.report.columns[0].alternatives, [], 'twin reduced away, not listed');
            // unpadded slash dates keep the classic dd/MM-vs-MM/dd honesty at the
            // unpadded level, without listing padded twins
            const slash = { headers: ['d'], rows: [['1/2/2026'], ['3/4/2026']] };
            const rs = TV().inferConfig(slash);
            assertEq(rs.draft.columns.d.type.formats, ['d/M/yyyy'], 'unpadded slash winner (candidate order)');
            assertEq(rs.report.columns[0].confidence, 'ambiguous', 'd/M vs M/d stays honest');
            assertEq(rs.report.columns[0].alternatives, [{ type: 'date', formats: ['M/d/yyyy'], rank: 1 }],
                'the other unpadded reading is the alternative');
        },
    });

    U.push({
        suite, name: 'new padded candidates (1.1.0): dd-MM-yyyy, yyyy/MM/dd, dd/MM/yyyy HH:mm',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            const dash = TV().inferConfig({ headers: ['d'], rows: [['15-07-2026'], ['03-12-2026']] });
            assertEq(dash.draft.columns.d.type.formats, ['dd-MM-yyyy'], 'dash dates infer');
            const ymd = TV().inferConfig({ headers: ['d'], rows: [['2026/07/15'], ['2026/12/03']] });
            assertEq(ymd.draft.columns.d.type.formats, ['yyyy/MM/dd'], 'slash ISO order infers');
            assertEq(ymd.report.columns[0].confidence, 'high', 'unambiguous');
            const dt = TV().inferConfig({ headers: ['t'], rows: [['15/07/2026 14:30'], ['16/07/2026 09:05']] });
            assertEq(dt.report.columns[0].inferredType, 'datetime', 'slash datetime infers');
            assertEq(dt.draft.columns.t.type.formats, ['dd/MM/yyyy HH:mm'], 'day 15 disambiguates dd/MM from MM/dd');
            assertN1(assert, dt.draft, 'slash-datetime');
        },
    });

    U.push({
        suite, name: 'digit-date guard (1.1.0): yyyyMMdd int columns carry a ranked date alternative',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            const t = { headers: ['d'], rows: [['20260715'], ['20260101'], ['20251231']] };
            const r = TV().inferConfig(t);
            assertEq(r.report.columns[0].inferredType, 'int', 'ladder order unchanged -- int still wins');
            assertEq(r.report.columns[0].confidence, 'ambiguous', 'no longer silently confident');
            assertEq(r.report.columns[0].reasons, ['digitDate'], 'reason recorded');
            assertEq(r.report.columns[0].alternatives, [{ type: 'date', formats: ['yyyyMMdd'], rank: 1 }],
                'the date reading is the rank-1 alternative');
            assertN1(assert, r.draft, 'digitDate');
            // 8 digits that are NOT a calendar date: plain int, high, no alternative
            const ids = TV().inferConfig({ headers: ['d'], rows: [['12345678'], ['87654321']] });
            assertEq(ids.report.columns[0].confidence, 'high', 'non-date 8-digit ids stay high');
            assertEq(ids.report.columns[0].alternatives, [], 'no false date alternative');
            // non-8-digit ints untouched
            const plain = TV().inferConfig({ headers: ['d'], rows: [['1001'], ['1002']] });
            assertEq(plain.report.columns[0].confidence, 'high', 'ordinary ints untouched');
        },
    });

    U.push({
        suite, name: 'suggestPrecision (1.1.0): default on, decoupled from suggestRanges, and it bites',
        fn: ({ assert, assertEq }) => {
            const t = { headers: ['amt'], rows: [['10.50'], ['3.25'], ['7.00']] };
            const r = TV().inferConfig(t);
            assertEq(r.draft.columns.amt.type.precision,
                { min: 2, max: 2, minInclusive: true, maxInclusive: true }, 'precision drafted by default');
            assertEq(r.draft.columns.amt.type.value, undefined, 'value ranges still off by default');
            assertN1(assert, r.draft, 'precision-default');
            const off = TV().inferConfig(t, { suggestPrecision: false });
            assertEq(off.draft.columns.amt.type.precision, undefined, 'opt-out honored');
            const ranges = TV().inferConfig(t, { suggestRanges: true, suggestPrecision: false });
            assertEq(ranges.draft.columns.amt.type.value,
                { min: 3.25, max: 10.5, minInclusive: true, maxInclusive: true }, 'ranges draftable alone');
            assertEq(ranges.draft.columns.amt.type.precision, undefined, 'suggestRanges no longer drags precision in');
            // the drafted constraint actually catches a precision breach
            const run = TV().validate(r.draft, { headers: ['amt'], rows: [['10.505']] });
            assert(!run.valid, 'a 3-decimal value violates the drafted 2-decimal contract');
            // mixed 0..2 decimals draft the observed spread, not a guess
            const spread = TV().inferConfig({ headers: ['amt'], rows: [['10'], ['3.2'], ['7.25']] });
            assertEq(spread.draft.columns.amt.type.precision,
                { min: 0, max: 2, minInclusive: true, maxInclusive: true }, 'observed bounds exactly');
        },
    });

    U.push({
        suite, name: 'rule 21/48 (1.1.0): d/M tokens legal with component coverage enforced',
        fn: ({ assert, assertEq }) => {
            const ok = TV().createConfigBuilder({ meta: { schemaVersion: '1.1.0', name: 'x' },
                columns: { c: { type: { name: 'date', formats: ['d.M.yyyy'] } } } }).validate();
            assert(ok.valid, 'd.M.yyyy is a valid date format: ' + JSON.stringify(ok.errors));
            const noYear = TV().createConfigBuilder({ meta: { schemaVersion: '1.1.0', name: 'x' },
                columns: { c: { type: { name: 'date', formats: ['d.M'] } } } }).validate();
            assert(!noYear.valid, 'd.M without a year still fails component coverage');
            const dInTime = TV().createConfigBuilder({ meta: { schemaVersion: '1.1.0', name: 'x' },
                columns: { c: { type: { name: 'time', formats: ['d HH:mm'] } } } }).validate();
            assert(!dInTime.valid, 'a day token in a time format is still rejected');
        },
    });


    // ---------------- v1.2.0: bare decimals, mixed-padding families, exhaustive ----------------

    U.push({
        suite, name: 'allowBareDecimal (1.2.0): ".85"-style floats infer, validate, and stay opt-in',
        fn: ({ assert, assertEq }) => {
            const t = { headers: ['v'], rows: [['.85'], ['.02'], ['0'], ['6.16']] };
            const r = TV().inferConfig(t);
            assertEq(r.report.columns[0].inferredType, 'float', 'bare decimals infer float');
            assertEq(r.draft.columns.v.type.formats,
                [{ decimalSeparator: '.', groupingSeparators: [','], allowBareDecimal: true }],
                'the bare-decimal NumberFormat is drafted');
            assertEq(r.draft.columns.v.type.precision,
                { min: 0, max: 2, minInclusive: true, maxInclusive: true }, 'precision from fractional digits');
            assertN1(assert, r.draft, 'bare');
            assert(TV().validate(r.draft, t).valid, 'round-trip: the draft validates its own sample');
            assert(!TV().validate(r.draft, { headers: ['v'], rows: [['.855']] }).valid,
                'drafted precision still bites on a bare decimal');
            // opt-in: without the flag the base grammar keeps rejecting bare decimals
            const strict = { meta: { schemaVersion: '1.2.0', name: 'x' }, evaluation: { strictType: false },
                columns: { v: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [','] }] } } } };
            assert(!TV().validate(strict, { headers: ['v'], rows: [['.85']] }).valid, 'without the flag .85 stays a typeMismatch');
            // ordinary formatted numbers keep drafting the STRICT candidate (tightest wins)
            const de = TV().inferConfig({ headers: ['v'], rows: [['1.234,50'], ['2,25']] });
            assertEq(de.draft.columns.v.type.formats,
                [{ decimalSeparator: ',', groupingSeparators: ['.'] }], 'strict candidates still win for ordinary data');
            // rule 12: bad shapes rejected
            const badBool = TV().createConfigBuilder({ meta: { schemaVersion: '1.2.0', name: 'x' },
                columns: { v: { type: { name: 'float', formats: [{ decimalSeparator: '.', groupingSeparators: [], allowBareDecimal: 'yes' }] } } } }).validate();
            assert(!badBool.valid, 'allowBareDecimal must be a boolean');
            const nullDs = TV().createConfigBuilder({ meta: { schemaVersion: '1.2.0', name: 'x' },
                columns: { v: { type: { name: 'float', formats: [{ decimalSeparator: null, groupingSeparators: [' '], allowBareDecimal: true }] } } } }).validate();
            assert(!nullDs.valid, 'allowBareDecimal: true requires a non-null decimalSeparator');
        },
    });

    U.push({
        suite, name: 'mixed-padding families (1.2.0): tightest accepting format wins within a family',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            // the reported case: day sometimes unpadded, month ALWAYS padded → d/MM, not d/M
            const rep = TV().inferConfig({ headers: ['d'], rows: [['1/01/2026'], ['22/12/2026']] });
            assertEq(rep.draft.columns.d.type.formats, ['d/MM/yyyy'], 'd/MM/yyyy — tightest fit for the evidence');
            assertEq(rep.report.columns[0].confidence, 'high', 'sole survivor after family reduction');
            assert(TV().validate(rep.draft, { headers: ['d'], rows: [['1/01/2026'], ['22/12/2026']] }).valid,
                'the tighter draft validates the sample');
            // all-padded and fully-unpadded columns are unchanged from 1.1.0
            const padded = TV().inferConfig({ headers: ['d'], rows: [['15.07.2026'], ['03.12.2026']] });
            assertEq(padded.draft.columns.d.type.formats, ['dd.MM.yyyy'], 'all-padded winner unchanged');
            const loose = TV().inferConfig({ headers: ['d'], rows: [['1.7.2026'], ['15.07.2026']] });
            assertEq(loose.draft.columns.d.type.formats, ['d.M.yyyy'], 'fully-mixed winner unchanged');
            // ISO-order families gain unpadded members
            const isoU = TV().inferConfig({ headers: ['d'], rows: [['2026-7-5'], ['2026-11-30']] });
            assertEq(isoU.draft.columns.d.type.formats, ['yyyy-M-d'], 'unpadded ISO order infers');
            const iso = TV().inferConfig({ headers: ['d'], rows: [['2026-07-05'], ['2026-11-30']] });
            assertEq(iso.draft.columns.d.type.formats, ['yyyy-MM-dd'], 'padded ISO unchanged');
        },
    });

    U.push({
        suite, name: 'exhaustive mode (1.2.0): whole-table inference, no sampling',
        fn: ({ assert, assertEq }) => {
            // 2 500 rows; the type-breaking values sit beyond the 1 000-row sample
            const rows = Array.from({ length: 2500 }, (_, i) => [i < 2400 ? String(i + 1) : 'x' + i]);
            const t = { headers: ['a'], rows };
            const sampled = TV().inferConfig(t);
            assertEq(sampled.report.columns[0].inferredType, 'int', 'the prefix sample sees only ints');
            assertEq(sampled.report.sample, { rowsAvailable: 2500, rowsSampled: 1000, exhaustive: false }, 'sample shape');
            const ex = TV().inferConfig(t, { exhaustive: true });
            assertEq(ex.report.columns[0].inferredType, 'string', 'exhaustive sees the tail and demotes honestly');
            assertEq(ex.report.sample, { rowsAvailable: 2500, rowsSampled: 2500, exhaustive: true }, 'whole table sampled');
            assertEq(ex.report.columns[0].sampleDerivedNullability, false,
                'exhaustive conclusions are facts of the data, not of a prefix');
            assertN1(assert, ex.draft, 'exhaustive');
            assert(JSON.stringify(TV().inferConfig(t, { exhaustive: true })) === JSON.stringify(ex), 'deterministic');
        },
    });

    // ---------------- v1.2.1: strictType counts canonical conversion (self-accepting) ----------------

    U.push({
        suite, name: 'strictType (1.2.1): mixed-native-kind string column forces strictType false and self-validates',
        fn: ({ assert, assertEq }) => {
            const t = { headers: ['a'], rows: [[1], [true], ['x']] };
            const { draft, report } = TV().inferConfig(t);
            const c = report.columns[0];
            assertEq(c.inferredType, 'string', 'mixed native kinds fall to string');
            assertEq(c.confidence, 'fallback', 'confidence fallback');
            assertEq(c.reasons, ['mixedNativeKinds'], 'reason mixedNativeKinds');
            assert(c.observed.reliedOnInterpretation, 'canonical conversion counts as interpretation (1.2.1)');
            assertEq(draft.evaluation.strictType, false, 'non-string participants force strictType false');
            assertN1(assert, draft, 'mixedNativeKinds');
            const run = TV().validate(draft, t);
            assert(run.valid && !run.aborted, 'the draft validates its own sample (self-accepting invariant)');
        },
    });

    U.push({
        suite, name: 'strictType (1.2.1): native NaN column reports nonStringParticipants and self-validates',
        fn: ({ assert, assertEq }) => {
            const t = { headers: ['a'], rows: [[NaN], [1.5]] };
            const { draft, report } = TV().inferConfig(t);
            const c = report.columns[0];
            assertEq(c.inferredType, 'string', 'NaN blocks every numeric step; the column falls to string');
            assertEq(c.confidence, 'fallback', 'confidence fallback');
            assertEq(c.reasons, ['nonStringParticipants'], 'a reason is reported (was empty before 1.2.1)');
            assert(c.observed.reliedOnInterpretation, 'native participants in a string column rely on interpretation');
            assertEq(draft.evaluation.strictType, false, 'strictType false');
            assertN1(assert, draft, 'nonStringParticipants');
            const run = TV().validate(draft, t);
            assert(run.valid && !run.aborted, 'the draft validates its own sample (self-accepting invariant)');
        },
    });


    // ---------------- v1.3.0: yy candidates, negatives, data-loss guard, honesty ----------------

    U.push({
        suite, name: 'yy candidates (1.3.0): two-digit-year columns infer with ambiguous/twoDigitYear, draft self-validates',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            const t = { headers: ['d'], rows: [['30/06/19'], ['01/12/20']] };
            const { draft, report } = TV().inferConfig(t);
            const c = report.columns[0];
            assertEq(c.inferredType, 'date', 'two-digit-year column infers date');
            assertEq(draft.columns.d.type.formats, ['dd/MM/yy'], 'dd/MM/yy drafted');
            assertEq(c.confidence, 'ambiguous', 'EVERY yy winner is ambiguous');
            assert(c.reasons.includes('twoDigitYear'), 'reason twoDigitYear present');
            assert(draft.evaluation.twoDigitYearPivot === undefined, 'drafts never emit the pivot (N4)');
            assertN1(assert, draft, 'yy');
            assert(TV().validate(draft, t).valid, 'draft validates its own sample');
            // family machinery covers yy families for free
            const fam = TV().inferConfig({ headers: ['d'], rows: [['1/01/19'], ['22/12/19']] });
            assertEq(fam.draft.columns.d.type.formats, ['d/MM/yy'], 'mixed padding reduces within the yy family');
            // 4-digit years never reach yy candidates (exactly-two-digit pin)
            const iso = TV().inferConfig({ headers: ['d'], rows: [['30/06/2019'], ['01/12/2020']] });
            assertEq(iso.draft.columns.d.type.formats, ['dd/MM/yyyy'], 'yyyy column keeps its 1.2.x winner');
            assertEq(iso.report.columns[0].confidence, 'high', 'no yy ambiguity leaks onto yyyy columns');
        },
    });

    U.push({
        suite, name: 'negativeStyle candidates (1.3.0): accounting and SAP columns infer; positives-only unchanged',
        fn: ({ assert, assertEq }) => {
            const acc = TV().inferConfig({ headers: ['a'], rows: [['(1,234.50)'], ['12.00']] });
            assertEq(acc.report.columns[0].inferredType, 'float', 'accounting column infers float');
            assertEq(acc.draft.columns.a.type.formats,
                [{ decimalSeparator: '.', groupingSeparators: [','], negativeStyle: 'parentheses' }],
                'parentheses format drafted');
            assertEq(acc.report.columns[0].observed.min, -1234.5, 'interpreted minimum is negative');
            assert(TV().validate(acc.draft, { headers: ['a'], rows: [['(1,234.50)'], ['12.00']] }).valid, 'self-validates');
            const sap = TV().inferConfig({ headers: ['a'], rows: [['1234.50-'], ['12.00']] });
            assertEq(sap.draft.columns.a.type.formats,
                [{ decimalSeparator: '.', groupingSeparators: [','], negativeStyle: 'trailingMinus' }],
                'trailing-minus format drafted');
            // positives-only columns keep the bare 1.2.x winner (no negativeStyle key)
            const pos = TV().inferConfig({ headers: ['a'], rows: [['1,234.50'], ['12.00']] });
            assertEq(pos.draft.columns.a.type.formats, [{ decimalSeparator: '.', groupingSeparators: [','] }],
                'strict candidate 1 still wins for ordinary data');
            // mixed decoration styles fall through to string, labeled numericLike
            const mixed = TV().inferConfig({ headers: ['a'], rows: [['-12.00'], ['(3.50)']] });
            assertEq(mixed.report.columns[0].inferredType, 'string', 'mixed sign notations stay conservative');
            assertEq(mixed.report.columns[0].confidence, 'fallback', 'honesty label');
            assertEq(mixed.report.columns[0].reasons, ['numericLike'], 'numericLike reason');
        },
    });

    U.push({
        suite, name: 'data-loss guard (1.3.0): leading zeros and unsafe magnitudes infer string with a numeric alternative',
        fn: ({ assert, assertEq }) => {
            const lz = TV().inferConfig({ headers: ['id'], rows: [['007'], ['042']] });
            assertEq(lz.report.columns[0].inferredType, 'string', 'zeros are data');
            assertEq(lz.report.columns[0].confidence, 'ambiguous', 'ambiguous, not silent');
            assertEq(lz.report.columns[0].reasons, ['leadingZeroInt'], 'reason');
            assertEq(lz.report.columns[0].alternatives, [{ type: 'int', formats: null, rank: 1 }], 'int alternative');
            assert(TV().validate(lz.draft, { headers: ['id'], rows: [['007'], ['042']] }).valid, 'self-validates');
            const dc = TV().inferConfig({ headers: ['id'], rows: [['1'], ['01']] });
            assertEq(dc.report.columns[0].observed.distinctCount, 2, '"1" and "01" stay distinct as strings');
            const un = TV().inferConfig({ headers: ['n'], rows: [['9007199254740993'], ['9007199254740995']] });
            assertEq(un.report.columns[0].inferredType, 'string', 'unsafe magnitudes are not silently lossy');
            assertEq(un.report.columns[0].reasons, ['unsafeInt'], 'reason');
            assertEq(un.report.columns[0].alternatives, [{ type: 'float', formats: null, rank: 1 }],
                'the lossy reading is the alternative (int would reject unsafe values)');
        },
    });

    U.push({
        suite, name: 'groupingAmbiguity (1.3.0): "1.234"-shaped columns flag both readings; any breaker disambiguates',
        fn: ({ assert, assertEq }) => {
            const dot = TV().inferConfig({ headers: ['n'], rows: [['1.234'], ['2.345']] });
            assertEq(dot.report.columns[0].inferredType, 'float', 'decimal reading wins (ladder unchanged)');
            assertEq(dot.report.columns[0].confidence, 'ambiguous', 'flagged');
            assertEq(dot.report.columns[0].reasons, ['groupingAmbiguity'], 'reason');
            assertEq(dot.report.columns[0].alternatives[0].type, 'int', 'grouped-integer alternative');
            const comma = TV().inferConfig({ headers: ['n'], rows: [['1,234'], ['2,345']] });
            assertEq(comma.report.columns[0].inferredType, 'int', 'grouped-int reading wins for commas');
            assert(comma.report.columns[0].reasons.includes('groupingAmbiguity'), 'flagged');
            assertEq(comma.report.columns[0].alternatives[0].type, 'float', 'decimal-comma alternative');
            const clear = TV().inferConfig({ headers: ['n'], rows: [['1.234'], ['12.5']] });
            assertEq(clear.report.columns[0].confidence, 'high', 'a breaking shape disambiguates silently');
        },
    });

    U.push({
        suite, name: 'null tokens (1.3.0): #N/A, None, -- adopt and union in candidate order',
        fn: ({ assert, assertEq }) => {
            const { draft, report } = TV().inferConfig({
                headers: ['a'], rows: [['#N/A'], ['None'], ['--'], ['x'], ['n/a']],
            });
            assertEq(draft.nullHandling.nullEquivalents, ['', '#N/A', 'n/a', 'None', '--'],
                'adopted tokens in fixed candidate order after ""');
            assertEq(report.columns[0].observed.nulls, 4, 'all four tokens effectively null');
            assert(TV().validate(draft, { headers: ['a'], rows: [['#N/A'], ['x']] }).valid, 'draft accepts the tokens');
        },
    });

    U.push({
        suite, name: 'minute + microsecond datetimes (1.3.0): new ISO candidates infer',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            const m = TV().inferConfig({ headers: ['t'], rows: [['2026-07-15 14:30'], ['2026-07-15 15:00']] });
            assertEq(m.report.columns[0].inferredType, 'datetime', 'minute precision infers datetime');
            assertEq(m.draft.columns.t.type.formats, ['yyyy-MM-dd HH:mm'], 'minute format drafted');
            assert(TV().validate(m.draft, { headers: ['t'], rows: [['2026-07-15 14:30']] }).valid, 'self-validates');
            const u = TV().inferConfig({ headers: ['t'], rows: [['2026-07-15 14:30:45.123456'], ['2026-07-16 09:00:00.000001']] });
            assertEq(u.draft.columns.t.type.formats, ['yyyy-MM-dd HH:mm:ss.SSSSSS'], 'DB timestamps infer SSSSSS');
        },
    });

    U.push({
        suite, name: 'categorical at the floor (1.3.0): a 3-value column qualifies at 20 rows (ratio 0.2)',
        fn: ({ assertEq }) => {
            const rows20 = rows(20, (i) => [['A', 'B', 'C'][i % 3]]);
            const r = TV().inferConfig({ headers: ['c'], rows: rows20 });
            assertEq(r.report.columns[0].inferredType, 'categorical', '20 rows suffice now');
            assertEq(r.draft.columns.c.type.allowedValues, ['A', 'B', 'C'], 'values sorted');
        },
    });

    U.push({
        suite, name: 'confidence honesty (1.3.0): structured-looking failures report fallback, plain text stays high',
        needsLuxon: true,
        fn: ({ assertEq }) => {
            const times = TV().inferConfig({ headers: ['t'], rows: [['9:05'], ['14:30']] });
            assertEq(times.report.columns[0].inferredType, 'string', 'unpadded times are not a candidate');
            assertEq(times.report.columns[0].confidence, 'fallback', 'honest label');
            assertEq(times.report.columns[0].reasons, ['temporalLike'], 'temporalLike');
            const months = TV().inferConfig({ headers: ['d'], rows: [['15-Jul-2026'], ['16-Aug-2026']] });
            assertEq(months.report.columns[0].reasons, ['temporalLike'], 'month names look temporal');
            const text = TV().inferConfig({ headers: ['s'], rows: [['hello world'], ['plain text']] });
            assertEq(text.report.columns[0].confidence, 'high', 'straightforwardly textual stays high');
        },
    });

    // ---------------- v1.4.0: inference long-tails (P2) ----------------

    U.push({
        suite, name: 'long-tail: native booleans win the bool ladder step; the 3 time-table candidates each infer',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            const { draft, report } = TV().inferConfig({ headers: ['a'], rows: [[true], [false], [true]] });
            const c = report.columns[0];
            assertEq(c.inferredType, 'bool', 'native booleans qualify for the bool win');
            assertEq(c.confidence, 'high', 'unambiguous');
            assertEq(draft.evaluation.strictType, true, 'native bool participants with relied=false keep strictType true');
            assert(!c.observed.reliedOnInterpretation, 'native bool reading needs no interpretation');
            assertN1(assert, draft, 'native-bool');

            const table = [
                { fmt: 'HH:mm:ss', rows: ['14:30:45', '09:00:12'] },
                { fmt: 'HH:mm', rows: ['14:30', '09:05'] },
                { fmt: 'HH:mm:ss.SSS', rows: ['14:30:45.123', '09:00:12.000'] },
            ];
            for (const { fmt, rows: r } of table) {
                const t = { headers: ['t'], rows: r.map((v) => [v]) };
                const res = TV().inferConfig(t);
                assertEq(res.report.columns[0].inferredType, 'time', `${fmt}: infers time`);
                assertEq(res.report.columns[0].confidence, 'high', `${fmt}: unambiguous`);
                assertEq(res.draft.columns.t.type.formats, [fmt], `${fmt}: drafted format`);
                assert(TV().validate(res.draft, t).valid, `${fmt}: draft validates its own sample`);
            }
        },
    });

    U.push({
        suite, name: 'long-tail: categorical rejection boundaries (participants<20; distinct>12; ratio>0.2) and typeStrict:false at the floor',
        fn: ({ assert, assertEq }) => {
            const rows19 = Array.from({ length: 19 }, (_, i) => [['A', 'B', 'C'][i % 3]]);
            const r19 = TV().inferConfig({ headers: ['c'], rows: rows19 });
            assertEq(r19.report.columns[0].inferredType, 'string', '19 participants: below the 20-row floor');

            // 65 rows, 13 distinct values: ratio is exactly 0.2 (at the ratio floor) but
            // distinct(13) > 12, so the distinct-count boundary alone rejects it
            const rows65 = Array.from({ length: 65 }, (_, i) => ['V' + (i % 13)]);
            const r65 = TV().inferConfig({ headers: ['c'], rows: rows65 });
            assertEq(r65.report.columns[0].inferredType, 'string', '13 distinct values: over the 12-distinct ceiling');

            // 20 rows, 6 distinct values: ratio 0.3 > 0.2
            const rows20a = Array.from({ length: 20 }, (_, i) => ['V' + (i % 6)]);
            const rA = TV().inferConfig({ headers: ['c'], rows: rows20a });
            assertEq(rA.report.columns[0].inferredType, 'string', 'ratio 0.3: over the 0.2 ceiling');

            // 20 rows, 4 distinct values: ratio exactly 0.2 -> qualifies (inclusive boundary)
            const rows20b = Array.from({ length: 20 }, (_, i) => ['V' + (i % 4)]);
            const rB = TV().inferConfig({ headers: ['c'], rows: rows20b });
            assertEq(rB.report.columns[0].inferredType, 'categorical', 'ratio exactly 0.2: qualifies');
            assertEq(rB.draft.columns.c.type.allowedValues, ['V0', 'V1', 'V2', 'V3'], 'values sorted');
            assertEq(rB.draft.columns.c.type.typeStrict, false, 'categorical drafts always relax typeStrict');
            assertN1(assert, rB.draft, 'categorical-floor');
        },
    });

    U.push({
        suite, name: 'long-tail: combined data-loss-guard reasons; combined yy reasons (solo + union coverage); union-coverage observed extremes',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            // B042: a column carrying BOTH the leadingZeroInt and unsafeInt reasons at once
            const combo = TV().inferConfig({ headers: ['id'], rows: [['007'], ['9007199254740993']] });
            const cc = combo.report.columns[0];
            assertEq(cc.inferredType, 'string', 'either data-loss reason keeps the column conservative');
            assertEq(cc.reasons, ['leadingZeroInt', 'unsafeInt'], 'both reasons present, in that order');
            assertEq(cc.alternatives, [{ type: 'float', formats: null, rank: 1 }], 'the lossy float reading is the alternative');

            // B043: a yy column where BOTH dd/MM/yy and MM/dd/yy accept -> multipleTemporalFormats + twoDigitYear
            const yyAmbig = TV().inferConfig({ headers: ['d'], rows: [['01/02/19'], ['03/04/19']] });
            const ya = yyAmbig.report.columns[0];
            assertEq(ya.inferredType, 'date', 'ambiguous yy column still infers the candidate-order winner');
            assertEq(ya.confidence, 'ambiguous', 'yy is always ambiguous');
            assertEq(ya.reasons, ['multipleTemporalFormats', 'twoDigitYear'], 'both reasons appended');
            assertEq(yyAmbig.draft.columns.d.type.formats, ['dd/MM/yy'], 'candidate-order winner drafted');
            assertEq(ya.alternatives, [{ type: 'date', formats: ['MM/dd/yy'], rank: 1 }], 'the other yy reading is the alternative');
            assertN1(assert, yyAmbig.draft, 'yy-combined-reasons');

            // B044: allAcceptingFormats union coverage that crosses into a yy candidate
            const union = { headers: ['d'], rows: [['30/06/19'], ['01/12/20'], ['2026-07-15']] };
            const onUnion = TV().inferConfig(union, { allAcceptingFormats: true });
            const uc = onUnion.report.columns[0];
            assertEq(uc.inferredType, 'date', 'union coverage infers date across families');
            assertEq(onUnion.draft.columns.d.type.formats, ['dd/MM/yy', 'yyyy-MM-dd', 'MM/dd/yy'],
                'winner then remaining accepting candidates in table order');
            assertEq(uc.reasons, ['mixedTemporalFormats', 'twoDigitYear'], 'both reasons for a cross-family yy winner');
            assertN1(assert, onUnion.draft, 'union-yy-combined');

            // B058: union-coverage observed.min/max use each participant's first accepting
            // format in draft order, not a single shared format
            const extremes = { headers: ['d'], rows: [['2026-07-15'], ['16.07.2026'], ['2026-01-02']] };
            const onExtremes = TV().inferConfig(extremes, { allAcceptingFormats: true });
            const ec = onExtremes.report.columns[0];
            assertEq(ec.observed.min, '2026-01-02', 'min reported as the original extreme string');
            assertEq(ec.observed.max, '16.07.2026', 'max reported as the original extreme string');
            assertEq(onExtremes.draft.columns.d.type.formats, ['yyyy-MM-dd', 'dd.MM.yyyy'], 'winner + used candidate');
        },
    });

    U.push({
        suite, name: "long-tail: temporalDisabled:luxon -- ladder step 5 is skipped and reported when the temporal engine is unavailable",
        fn: ({ assertEq }) => {
            const saved = window.luxon;
            window.luxon = undefined;
            let r;
            try {
                r = TV().inferConfig({ headers: ['d'], rows: [['2026-07-15'], ['2026-07-16']] });
            } finally {
                window.luxon = saved;
            }
            assertEq(r.report.limitations, ['temporalDisabled:luxon'], 'limitation reported when Luxon is absent');
            assertEq(r.report.columns[0].inferredType, 'string', 'temporal ladder step skipped -> falls to string');
            assertEq(r.report.columns[0].confidence, 'fallback', 'honest fallback confidence');
            assertEq(r.report.columns[0].reasons, ['numericLike'],
                'the numericLike char-class check runs before temporalLike; dashes/digits satisfy it');
            // sanity: restoring Luxon (only meaningful when this environment actually has it)
            // brings back full temporal inference, proving the disabled state was not sticky
            if (saved) {
                const after = TV().inferConfig({ headers: ['d'], rows: [['2026-07-15'], ['2026-07-16']] });
                assertEq(after.report.limitations, [], 'no limitation once Luxon is back');
                assertEq(after.report.columns[0].inferredType, 'date', 'temporal inference restored');
            }
        },
    });

    U.push({
        suite, name: 'long-tail: all 16 two-digit-year (yy) date candidates individually exercised',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            const table = [
                { fmt: 'dd/MM/yy', rows: ['30/06/19', '01/12/20'] },     // already the ladder winner elsewhere; sanity-checked here too
                { fmt: 'd/MM/yy', rows: ['1/01/19', '22/12/19'] },
                { fmt: 'dd/M/yy', rows: ['25/6/19', '13/06/20'] },
                { fmt: 'd/M/yy', rows: ['25/3/19', '6/11/20'] },
                { fmt: 'MM/dd/yy', rows: ['06/25/19', '01/13/20'] },
                { fmt: 'M/dd/yy', rows: ['6/25/19', '11/13/20'] },
                { fmt: 'MM/d/yy', rows: ['06/3/19', '01/25/20'] },
                { fmt: 'M/d/yy', rows: ['6/25/19', '11/4/20'] },
                { fmt: 'dd.MM.yy', rows: ['30.06.19', '01.12.20'] },
                { fmt: 'd.MM.yy', rows: ['1.07.19', '25.12.20'] },
                { fmt: 'dd.M.yy', rows: ['25.7.19', '13.12.20'] },
                { fmt: 'd.M.yy', rows: ['1.7.19', '23.11.20'] },
                { fmt: 'dd-MM-yy', rows: ['30-06-19', '01-12-20'] },
                { fmt: 'd-MM-yy', rows: ['1-07-19', '25-12-20'] },
                { fmt: 'dd-M-yy', rows: ['25-7-19', '13-12-20'] },
                { fmt: 'd-M-yy', rows: ['1-7-19', '23-11-20'] },
            ];
            for (const { fmt, rows: r } of table) {
                const t = { headers: ['d'], rows: r.map((v) => [v]) };
                const res = TV().inferConfig(t);
                assertEq(res.report.columns[0].inferredType, 'date', `${fmt}: infers date`);
                assertEq(res.report.columns[0].confidence, 'ambiguous', `${fmt}: every yy winner is ambiguous`);
                assert(res.report.columns[0].reasons.includes('twoDigitYear'), `${fmt}: twoDigitYear reason present`);
                assertEq(res.draft.columns.d.type.formats, [fmt], `${fmt}: drafted format`);
                assert(TV().validate(res.draft, t).valid, `${fmt}: draft validates its own sample`);
            }
        },
    });

    U.push({
        suite, name: 'long-tail: numeric-format candidates 3-5 (space/apostrophe grouping); bare-decimal candidates 7-10; negativeStyle candidates 12-15 and 17-20',
        fn: ({ assert, assertEq }) => {
            const numeric = [
                { fmt: { decimalSeparator: ',', groupingSeparators: [' '] }, rows: ['1 234,50', '2 345,10'] },
                { fmt: { decimalSeparator: '.', groupingSeparators: [' '] }, rows: ['1 234.50', '2 345.10'] },
                { fmt: { decimalSeparator: '.', groupingSeparators: ["'"] }, rows: ["1'234.50", "2'345.10"] },
            ];
            const bare = [
                { fmt: { decimalSeparator: ',', groupingSeparators: ['.'], allowBareDecimal: true }, rows: ['1.234,50', ',85'] },
                { fmt: { decimalSeparator: ',', groupingSeparators: [' '], allowBareDecimal: true }, rows: ['1 234,50', ',85'] },
                { fmt: { decimalSeparator: '.', groupingSeparators: [' '], allowBareDecimal: true }, rows: ['1 234.50', '.85'] },
                { fmt: { decimalSeparator: '.', groupingSeparators: ["'"], allowBareDecimal: true }, rows: ["1'234.50", '.85'] },
            ];
            const negative = [
                { fmt: { decimalSeparator: ',', groupingSeparators: ['.'], negativeStyle: 'parentheses' }, rows: ['(1.234,50)', '12,00'] },
                { fmt: { decimalSeparator: ',', groupingSeparators: [' '], negativeStyle: 'parentheses' }, rows: ['(1 234,50)', '12,00'] },
                { fmt: { decimalSeparator: '.', groupingSeparators: [' '], negativeStyle: 'parentheses' }, rows: ['(1 234.50)', '12.00'] },
                { fmt: { decimalSeparator: '.', groupingSeparators: ["'"], negativeStyle: 'parentheses' }, rows: ["(1'234.50)", '12.00'] },
                { fmt: { decimalSeparator: ',', groupingSeparators: ['.'], negativeStyle: 'trailingMinus' }, rows: ['1.234,50-', '12,00'] },
                { fmt: { decimalSeparator: ',', groupingSeparators: [' '], negativeStyle: 'trailingMinus' }, rows: ['1 234,50-', '12,00'] },
                { fmt: { decimalSeparator: '.', groupingSeparators: [' '], negativeStyle: 'trailingMinus' }, rows: ['1 234.50-', '12.00'] },
                { fmt: { decimalSeparator: '.', groupingSeparators: ["'"], negativeStyle: 'trailingMinus' }, rows: ["1'234.50-", '12.00'] },
            ];
            for (const { fmt, rows: r } of numeric.concat(bare, negative)) {
                const t = { headers: ['v'], rows: r.map((v) => [v]) };
                const res = TV().inferConfig(t);
                assertEq(res.report.columns[0].inferredType, 'float', `${JSON.stringify(fmt)}: infers float`);
                assertEq(res.report.columns[0].confidence, 'high', `${JSON.stringify(fmt)}: unambiguous`);
                assertEq(res.draft.columns.v.type.formats, [fmt], `${JSON.stringify(fmt)}: drafted NumberFormat`);
                assert(TV().validate(res.draft, t).valid, `${JSON.stringify(fmt)}: draft validates its own sample`);
            }
        },
    });

    U.push({
        suite, name: 'long-tail: 9 of the 13 datetime candidates; 9 of the 21 yyyy-family date candidates',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            const datetime = [
                { fmt: 'yyyy-MM-dd HH:mm:ss', rows: ['2026-07-15 14:30:45', '2026-07-16 09:00:12'] },
                { fmt: "yyyy-MM-dd'T'HH:mm:ss.SSS", rows: ['2026-07-15T14:30:45.123', '2026-07-16T09:00:12.000'] },
                { fmt: "yyyy-MM-dd'T'HH:mm:ssZZ", rows: ['2026-07-15T14:30:45+02:00', '2026-07-16T09:00:12+00:00'] },
                { fmt: "yyyy-MM-dd'T'HH:mm:ss.SSSZZ", rows: ['2026-07-15T14:30:45.123+02:00', '2026-07-16T09:00:12.000+00:00'] },
                { fmt: 'dd.MM.yyyy HH:mm:ss', rows: ['15.07.2026 14:30:45', '16.07.2026 09:00:12'] },
                { fmt: 'dd.MM.yyyy HH:mm', rows: ['15.07.2026 14:30', '16.07.2026 09:05'] },
                { fmt: 'MM/dd/yyyy HH:mm', rows: ['06/25/2026 14:30', '01/13/2026 09:05'] },
                { fmt: "yyyy-MM-dd'T'HH:mm", rows: ['2026-07-15T14:30', '2026-07-16T09:05'] },
                { fmt: "yyyy-MM-dd'T'HH:mm:ss.SSSSSS", rows: ['2026-07-15T14:30:45.123456', '2026-07-16T09:00:12.000001'] },
            ];
            for (const { fmt, rows: r } of datetime) {
                const t = { headers: ['t'], rows: r.map((v) => [v]) };
                const res = TV().inferConfig(t);
                assertEq(res.report.columns[0].inferredType, 'datetime', `${fmt}: infers datetime`);
                assertEq(res.report.columns[0].confidence, 'high', `${fmt}: unambiguous`);
                assertEq(res.draft.columns.t.type.formats, [fmt], `${fmt}: drafted format`);
                assert(TV().validate(res.draft, t).valid, `${fmt}: draft validates its own sample`);
            }

            const dateYyyy = [
                { fmt: 'd.MM.yyyy', rows: ['1.07.2026', '25.12.2026'] },
                { fmt: 'dd.M.yyyy', rows: ['25.7.2026', '13.12.2026'] },
                { fmt: 'dd/M/yyyy', rows: ['25/2/2026', '13/11/2026'] },   // month '2'/'11' — unpadded+neutral, no mixed-padding (1.5.0)
                { fmt: 'M/dd/yyyy', rows: ['7/25/2026', '11/13/2026'] },
                { fmt: 'MM/d/yyyy', rows: ['06/25/2026', '11/4/2026'] },
                { fmt: 'd-MM-yyyy', rows: ['1-07-2026', '25-12-2026'] },
                { fmt: 'dd-M-yyyy', rows: ['25-7-2026', '13-12-2026'] },
                { fmt: 'd-M-yyyy', rows: ['1-7-2026', '23-11-2026'] },
                { fmt: 'yyyy/M/d', rows: ['2026/1/15', '2026/11/3'] },
            ];
            for (const { fmt, rows: r } of dateYyyy) {
                const t = { headers: ['d'], rows: r.map((v) => [v]) };
                const res = TV().inferConfig(t);
                assertEq(res.report.columns[0].inferredType, 'date', `${fmt}: infers date`);
                assertEq(res.report.columns[0].confidence, 'high', `${fmt}: unambiguous`);
                assertEq(res.draft.columns.d.type.formats, [fmt], `${fmt}: drafted format`);
                assert(TV().validate(res.draft, t).valid, `${fmt}: draft validates its own sample`);
            }
        },
    });

    U.push({
        suite, name: 'long-tail: 1.3.0 null tokens na/none adopt; pre-1.3.0 tokens N/A, null, NULL, - adopt',
        fn: ({ assert, assertEq }) => {
            const naNone = TV().inferConfig({ headers: ['a'], rows: [['na'], ['none'], ['x']] });
            assertEq(naNone.draft.nullHandling.nullEquivalents, ['', 'na', 'none'], 'both lowercase tokens adopted, candidate order');
            assertEq(naNone.report.columns[0].observed.nullTokensSeen, { na: 1, none: 1 }, 'both counted');
            assert(TV().validate(naNone.draft, { headers: ['a'], rows: [['na'], ['x']] }).valid, 'draft accepts the tokens');

            const pre130 = TV().inferConfig({ headers: ['a'], rows: [['N/A'], ['null'], ['NULL'], ['-'], ['x']] });
            assertEq(pre130.draft.nullHandling.nullEquivalents, ['', 'N/A', 'null', 'NULL', '-'],
                'all four pre-1.3.0 tokens adopted, candidate order');
            assertEq(pre130.report.columns[0].observed.nullTokensSeen, { 'N/A': 1, null: 1, NULL: 1, '-': 1 }, 'all four counted');
            assert(TV().validate(pre130.draft, { headers: ['a'], rows: [['NULL'], ['x']] }).valid, 'draft accepts the tokens');
        },
    });

    // ---------------- v1.4.0: Addendum C inference behaviors (P10) ----------------

    U.push({
        suite, name: 'B022: numeric-only bool alternative pins the reasons literal numericStringBoolAlternative',
        fn: ({ assert, assertEq }) => {
            const t = { headers: ['bin'], rows: rows(25, (i) => [i % 2 ? '1' : '0']) };
            const { draft, report } = TV().inferConfig(t);
            const c = report.columns[0];
            assertEq(c.inferredType, 'int', 'numeric-only bool tokens do not infer bool');
            assertEq(c.confidence, 'ambiguous', 'the bool alternative makes this ambiguous');
            assertEq(c.reasons, ['numericStringBoolAlternative'], 'the reasons literal itself is pinned, not just alternatives/confidence');
            assertEq(c.alternatives, [{ type: 'bool', formats: null, rank: 1 }], 'bool reading is the ranked alternative');
            assertN1(assert, draft, 'numeric-bool-alt');
            assert(TV().validate(draft, t).valid, 'the draft validates its own sample');
        },
    });

    U.push({
        suite, name: "B023: digit-date guard's native-integer arm (canonical(p) branch, not just string cells)",
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            // native (non-string) 8-digit numbers that are valid yyyyMMdd calendar dates
            const t = { headers: ['d'], rows: [[20260715], [20260101], [20251231]] };
            const { draft, report } = TV().inferConfig(t);
            const c = report.columns[0];
            assertEq(c.inferredType, 'int', 'ladder order unchanged -- int still wins for native numbers too');
            assertEq(c.confidence, 'ambiguous', 'native-number participants still trip the guard');
            assertEq(c.reasons, ['digitDate'], 'reason recorded for the native-integer arm');
            assertEq(c.alternatives, [{ type: 'date', formats: ['yyyyMMdd'], rank: 1 }],
                'the date reading is the rank-1 alternative, derived via canonical(p) rather than the raw string');
            assertN1(assert, draft, 'digitDate-native');
            assert(TV().validate(draft, t).valid, 'the draft validates its own sample');

            // control: native 8-digit numbers that do NOT form a valid calendar date stay unguarded
            const ids = TV().inferConfig({ headers: ['d'], rows: [[12345678], [87654321]] });
            assertEq(ids.report.columns[0].confidence, 'high', 'non-date native 8-digit ids stay high');
            assertEq(ids.report.columns[0].reasons, [], 'no false digitDate reason for native non-dates');
            assertEq(ids.report.columns[0].alternatives, [], 'no false date alternative for native non-dates');

            // mixed native numbers + strings in the same column: canonical(p) and the raw
            // string both feed the same regex/Luxon check, so the guard still fires
            const mixed = TV().inferConfig({ headers: ['d'], rows: [[20260715], ['20260101']] });
            assertEq(mixed.report.columns[0].reasons, ['digitDate'], 'guard fires across mixed native/string participants');
        },
    });

    U.push({
        suite, name: 'B024: report-only tolerance suggestion formula (0.5 x 10^-maxPrecision) holds across precisions, not just one illustrative value',
        fn: ({ assert, assertEq }) => {
            const table = [
                { p: 1, cells: ['1.2', '3.4'], suggested: 0.05 },
                { p: 2, cells: ['1.22', '3.44'], suggested: 0.005 },
                { p: 3, cells: ['1.222', '3.444'], suggested: 0.0005 },
                { p: 4, cells: ['1.2222', '3.4444'], suggested: 0.00005 },
            ];
            for (const { p, cells, suggested } of table) {
                const t = { headers: ['v'], rows: cells.map((v) => [v]) };
                const { report } = TV().inferConfig(t);
                assertEq(report.columns[0].observed.maxPrecision, p, `maxPrecision=${p}: observed precision matches the fixture`);
                assertEq(report.suggestions.tolerances, [{ column: 'v', suggested, basis: `observedPrecision:${p}` }],
                    `maxPrecision=${p}: suggested value and basis string both follow 0.5 x 10^-p`);
            }
        },
    });

    U.push({
        suite, name: "B025: digit-date guard's own silent dependency on the temporal binding -- when Luxon is unavailable the guard no-ops (not just ladder step 5)",
        fn: ({ assertEq }) => {
            const saved = window.luxon;
            window.luxon = undefined;
            let r;
            try {
                // 8-digit yyyyMMdd-shaped strings that WOULD trip the digit-date guard if
                // Luxon were present (see the 'digit-date guard' vector above, needsLuxon:true)
                r = TV().inferConfig({ headers: ['d'], rows: [['20260715'], ['20260101'], ['20251231']] });
            } finally {
                window.luxon = saved;
            }
            assertEq(r.report.limitations, ['temporalDisabled:luxon'], 'limitation reported when Luxon is absent');
            assertEq(r.report.columns[0].inferredType, 'int', 'plain int -- the guard depends on the same lux binding as ladder step 5');
            assertEq(r.report.columns[0].confidence, 'high', 'no silent ambiguity: the guard cleanly no-ops rather than half-firing');
            assertEq(r.report.columns[0].reasons, [], 'no digitDate reason without the temporal engine');
            assertEq(r.report.columns[0].alternatives, [], 'no date alternative without the temporal engine');
        },
    });

    U.push({
        suite, name: 'B026: allAcceptingFormats union-coverage within-family reduction at unequal per-participant accept counts',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            // '1/07/2026' accepts the whole day-month slash family (d/MM, dd/MM, d/M, dd/M
            // all read day=1); '22/12/2026' only accepts the dd/MM-shaped members (day=22
            // rules out single-digit-day formats); the slash family therefore reduces to
            // its sole common survivor d/MM/yyyy at count 2. '15.07.2026' is a distinct
            // dotted family, reducing independently to dd.MM.yyyy at count 1. A genuine
            // cross-family reading (M/dd/yyyy, day=7/month=15 impossible so this is really
            // testing the union set, not a fourth candidate) is exercised by the existing
            // allAcceptingFormats vector; this vector isolates the within-family count-based
            // reduction the union path applies before ranking.
            const t = { headers: ['d'], rows: [['1/07/2026'], ['22/12/2026'], ['15.07.2026']] };
            const { draft, report } = TV().inferConfig(t, { allAcceptingFormats: true });
            const c = report.columns[0];
            assertEq(c.inferredType, 'date', 'union coverage still infers date');
            assertEq(c.confidence, 'ambiguous', 'union coverage across families is ambiguous');
            assertEq(c.reasons, ['mixedTemporalFormats'], 'cross-family union reason');
            assertEq(draft.columns.d.type.formats, ['d/MM/yyyy', 'dd.MM.yyyy', 'M/dd/yyyy'],
                'winner (highest accepted count) then remaining used candidates in table order -- ' +
                'the slash family reduced to its sole survivor, not left with redundant generalizations');
            assertEq(c.alternatives, [
                { type: 'date', formats: ['dd.MM.yyyy'], rank: 1 },
                { type: 'date', formats: ['M/dd/yyyy'], rank: 2 },
            ], 'ranked alternatives reflect the reduced union set, ranked by accepted count');
            assertN1(assert, draft, 'union-family-reduction');
            assert(TV().validate(draft, t).valid, 'the draft validates its own sample');
        },
    });

    // ---------------- v1.5.0: mixedPadding signal (§C.4/§C.8) + decimalText advisory (§C.8) ----------------

    U.push({
        suite, name: 'mixedPadding (§C.4/§C.8): mixed padded/unpadded components under an unpadded winner fire the signal',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            const t = { headers: ['d'], rows: [['01/01/2026'], ['2/01/2026'], ['03/1/2026']] };
            const { draft, report } = TV().inferConfig(t);
            const c = report.columns[0];
            assertEq(c.inferredType, 'date', 'winner is a date');
            assertEq(draft.columns.d.type.formats, ['d/M/yyyy'], 'tightest cross-family survivor is the winner');
            assertEq(c.confidence, 'ambiguous', 'a mixed padded/unpadded style is a reviewer judgment');
            assertEq(c.reasons, ['multipleTemporalFormats', 'mixedPadding'],
                'fixed append order: temporal-ambiguity then mixedPadding');
            assertEq(c.alternatives, [{ type: 'date', formats: ['M/d/yyyy'], rank: 1 }],
                'mixedPadding ADDS no alternative; the cross-family tie supplies M/d/yyyy');
            assertEq(c.observed.paddingStyle,
                { day: { padded: 2, unpadded: 1, neutral: 0 }, month: { padded: 2, unpadded: 1, neutral: 0 } },
                'per-component evidence keyed by the winner tokens (day/month); both mixed 2/1/0');
            // draft byte-identical + self-accepting (§C.1): it still validates its own sample
            assertN1(assert, draft, 'mixedPadding');
            assert(TV().validate(draft, t).valid, 'the byte-identical draft validates its own sample');
        },
    });

    U.push({
        suite, name: 'mixedPadding must NOT fire: all-padded / consistently-unpadded / neutral-heavy carry no paddingStyle',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            // consistently unpadded; the >12 value 22 is neutral, so the day component has no
            // padded evidence — the column stays HIGH
            const unpad = TV().inferConfig({ headers: ['d'], rows: [['1/01/2026'], ['22/12/2026']] });
            assertEq(unpad.draft.columns.d.type.formats, ['d/MM/yyyy'], 'reduction picks d/MM/yyyy');
            assertEq(unpad.report.columns[0].confidence, 'high', 'consistently-unpadded stays high');
            assertEq(unpad.report.columns[0].reasons, [], 'no mixedPadding');
            assertEq(unpad.report.columns[0].observed.paddingStyle, null, 'no paddingStyle when the signal does not fire');
            // all-padded: the winner carries no unpadded token, so the detection inspects nothing.
            // A >12 day (13) disambiguates the cross-family tie, so the label is a clean high.
            const allPad = TV().inferConfig({ headers: ['d'], rows: [['01/02/2026'], ['13/02/2026']] });
            assertEq(allPad.draft.columns.d.type.formats, ['dd/MM/yyyy'], 'padded winner');
            assertEq(allPad.report.columns[0].confidence, 'high', 'all-padded stays high');
            assert(!allPad.report.columns[0].reasons.includes('mixedPadding'), 'a padded winner is never examined');
            assertEq(allPad.report.columns[0].observed.paddingStyle, null, 'no paddingStyle');
            // neutral-heavy (values >= 10 are neutral evidence of neither style)
            const neutral = TV().inferConfig({ headers: ['d'], rows: [['10/13/2026'], ['11/13/2026'], ['1/13/2026']] });
            assertEq(neutral.report.columns[0].confidence, 'high', 'neutral-heavy stays high');
            assert(!neutral.report.columns[0].reasons.includes('mixedPadding'), 'neutral renderings fire nothing');
            assertEq(neutral.report.columns[0].observed.paddingStyle, null, 'no paddingStyle');
            // the literal §C.4 all-padded example {01/02/2026, 03/02/2026} is INDEPENDENTLY
            // ambiguous (dd/MM vs MM/dd, no >12 disambiguator) — but mixedPadding still does NOT
            // fire, since the winner token is padded (see the engine-surgeon escalation note)
            const lit = TV().inferConfig({ headers: ['d'], rows: [['01/02/2026'], ['03/02/2026']] });
            assertEq(lit.report.columns[0].reasons, ['multipleTemporalFormats'],
                'cross-family ambiguity only; mixedPadding absent under a padded winner');
            assertEq(lit.report.columns[0].observed.paddingStyle, null, 'padded winner → no paddingStyle');
        },
    });

    U.push({
        suite, name: 'decimalText advisory (§C.8): uniform dot-decimal float rides in reasons WITHOUT changing the high label; pins tolerance + pattern',
        fn: ({ assert, assertEq }) => {
            const money = TV().inferConfig({ headers: ['amt'], rows: [['1.50'], ['2.00'], ['3.25']] });
            const c = money.report.columns[0];
            assertEq(c.inferredType, 'float', 'money-shaped text is float');
            assertEq(c.confidence, 'high',
                'decimalText is advisory — the high label is UNCHANGED (the one reason that can accompany high)');
            assertEq(c.reasons, ['decimalText'], 'the advisory reason is appended');
            assertEq(money.report.suggestions.tolerances,
                [{ column: 'amt', suggested: 0.005, basis: 'observedPrecision:2' }],
                'mandatory + pinned: 0.5×10^−k = 0.005, basis observedPrecision:2');
            assertEq(money.report.suggestions.patterns,
                [{ column: 'amt', suggested: '0.00', basis: 'decimals:2,participants:3' }],
                'the §C.7 pattern suggestion rides beside it (unanimity holds by construction)');
            assertN1(assert, money.draft, 'decimalText');
            // varying fractional-digit count → NO advisory (the predicate needs one uniform scale)
            const mixedK = TV().inferConfig({ headers: ['amt'], rows: [['1.5'], ['2.50']] });
            assert(!mixedK.report.columns[0].reasons.includes('decimalText'), 'mixed k → no advisory');
            // grouping-ambiguous shape does NOT fire (it also reads as a grouped integer)
            const ga = TV().inferConfig({ headers: ['amt'], rows: [['1.234'], ['5.678']] });
            assert(ga.report.columns[0].reasons.includes('groupingAmbiguity'), 'this shape is grouping-ambiguous');
            assert(!ga.report.columns[0].reasons.includes('decimalText'), 'grouping-ambiguous shapes are not settled money evidence');
        },
    });

})();
