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
            assertEq(a.report.sample, { rowsAvailable: 50, rowsSampled: 10 }, 'bounded prefix sample');
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
})();
