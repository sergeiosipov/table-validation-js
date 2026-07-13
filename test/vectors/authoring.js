/* Authoring module — configModel + createConfigBuilder (Addendum §A, JS spec §3.11). */
'use strict';
(function () {
    const U = window.__UNIT__;
    const suite = 'authoring (configModel + builder)';
    const TV = () => window.TableValidation;

    const cleanSchema = () => ({
        meta: { schemaVersion: '1.0.0', name: 'demo' },
        columns: {
            id: { type: { name: 'int' }, unique: { enabled: true } },
            amount: { type: { name: 'float' } },
        },
    });

    U.push({
        suite, name: 'configModel: shape, completeness signals, frozen, JSON-serializable',
        fn: ({ assert, assertEq }) => {
            const m = TV().configModel;
            assertEq(m.specVersion, TV().SPEC_VERSION, 'specVersion matches SPEC_VERSION (rule M4)');
            assert(Array.isArray(m.settings) && m.settings.length >= 100, 'settings enumerated');
            assert(Array.isArray(m.crossRules) && m.crossRules.length >= 8, 'crossRules present');
            assert(Object.isFrozen(m) && Object.isFrozen(m.settings) && Object.isFrozen(m.settings[0]),
                'descriptor is deeply frozen (data, not API)');
            for (const s of m.settings) {
                assert(typeof s.path === 'string' && typeof s.section === 'string' && typeof s.type === 'string',
                    `descriptor core fields on ${s.path}`);
                assert(typeof s.required === 'boolean' && Array.isArray(s.engines) && Array.isArray(s.dependsOn),
                    `descriptor flags on ${s.path}`);
                assert(s.doc && typeof s.doc.description === 'string' && s.doc.description.length > 0,
                    `doc.description on ${s.path}`);
                assert(s.required ? s.default === undefined : 'default' in s,
                    `default present iff optional on ${s.path}`);
            }
            const rt = JSON.parse(JSON.stringify(m));
            assertEq(rt.settings.length, m.settings.length, 'JSON round-trips');
            // spot-check descriptor content against Core §12
            const byPath = (p, sec) => m.settings.find((s) => s.path === p && (!sec || s.section === sec));
            assertEq(byPath('resultConfig.maxSamples').default, 5, 'maxSamples default');
            assertEq(byPath('evaluation.strictType').default, true, 'strictType default');
            assertEq(byPath('columns.<name>.type.formats', 'type:datetime').required, true, 'temporal formats required');
            assertEq(byPath('comparison.severity.toleranceMatch').default, 'none', 'toleranceMatch default');
            assertEq(byPath('comparison.match.keys').engines, ['compare'], 'comparison settings are compare-only');
            assertEq(byPath('resultConfig.maxErrorsPerColumn').engines, ['validate'], 'maxErrorsPerColumn validate-only');
            // relevance/dependency predicates use the §A.2 grammar
            const rf = byPath('columns.<name>.type.regexFlags');
            assertEq(rf.dependsOn[0].kind, 'requires', 'regexFlags requires regex (rule 24)');
            assertEq(rf.dependsOn[0].predicate.path, 'columns.<name>.type.regex', 'predicate path placeholder-scoped');
            const fm = byPath('structure.fieldNameMatching');
            assertEq(fm.relevantWhen, { path: 'structure.columnMatching', op: 'eq', value: 'byName' }, 'byName relevance');
        },
    });

    U.push({
        suite, name: 'builder: authoring-time validation parity with the engine (rule M6)',
        fn: ({ assert, assertEq }) => {
            // clean schema: builder valid ⇒ engine must not abort schemaInvalid
            const ok = TV().createConfigBuilder(cleanSchema()).validate();
            assert(ok.valid && ok.errors.length === 0 && ok.deferred.length === 0, 'clean schema authoring-valid');
            const run = TV().validate(cleanSchema(), { headers: ['id', 'amount'], rows: [[1, 2.5]] });
            assert(!run.aborted, 'engine agrees: no schemaInvalid abort');

            // broken schema: same Phase-1 context path from both
            const bad = cleanSchema();
            bad.columns.id.type = { name: 'string', regexFlags: 'i' };   // rule 24: flags without regex
            const a = TV().createConfigBuilder(bad).validate();
            assert(!a.valid && a.errors.length === 1, 'builder flags rule 24');
            const engineRes = TV().validate(bad, { headers: ['id', 'amount'], rows: [] });
            assertEq(engineRes.aborted, true, 'engine aborts');
            assertEq(engineRes.abortReason, 'schemaInvalid', 'schemaInvalid reason');
            assertEq(a.errors[0].path, engineRes.summary.details[0].context.path,
                'builder and engine report the same offending path');
        },
    });

    U.push({
        suite, name: 'builder: advisories mirror the §8.2 irrelevantSetting preview',
        fn: ({ assert, assertEq }) => {
            const s = cleanSchema();
            s.columns.id.unique = { enabled: true, nullsEqual: true };   // nullable=false ⇒ irrelevant
            const a = TV().createConfigBuilder(s).validate();
            assert(a.valid, 'advisories do not invalidate');
            assertEq(a.advisories.length, 1, 'one advisory');
            assertEq(a.advisories[0].setting, 'columns.id.unique.nullsEqual', 'advisory setting path');
            const run = TV().validate(s, { headers: ['id', 'amount'], rows: [] });
            const adv = run.summary.details.find((d) => d.ruleName === 'irrelevantSetting');
            assertEq(a.advisories[0], adv.context, 'identical context as the engine advisory');
        },
    });

    U.push({
        suite, name: 'builder: deferred rules (10:30) reported, checked when the binding is supplied',
        fn: ({ assert, assertEq }) => {
            const b = TV().createConfigBuilder(cleanSchema())
                .addRowCheck({ name: 'c1', type: 'custom', fn: 'f1' });
            assertEq(b.validate().deferred, ['10:30'], 'no registry → rule 30 deferred, never silently passed');
            assert(b.validate().valid, 'deferred does not fail validation');
            assert(b.validate({ functions: { f1: () => [] } }).valid, 'registry with fn → checkable and valid');
            const miss = b.validate({ functions: {} });
            assert(!miss.valid && miss.deferred.length === 0, 'registry without fn → real rule-30 error, not deferred');
            // comparison-side fn families defer under their own ids
            const b2 = TV().createConfigBuilder(cleanSchema()).setComparison({
                match: { keys: ['id'] },
                fields: { amount: { tolerance: { fn: 'tol1' } } },
            });
            assertEq(b2.validate().deferred, ['C5'], 'tolerance fn defers as C5');
        },
    });

    U.push({
        suite, name: 'builder: exhaustive errors — N independent defects reported in one pass',
        fn: ({ assert, assertEq }) => {
            // six independent defects across different sections/columns/entries
            const bad = {
                meta: { schemaVersion: '1.0.0', name: '' },                       // 1: rule 1 (empty name)
                resultConfig: { maxSamples: 0 },                                   // 2: rule 49
                structure: { columnMatching: 'sideways' },                         // 3: rule 6
                columns: {
                    id: { type: { name: 'int' }, nullable: 'yes' },                // 4: rule 7 (bad nullable)
                    amount: { type: { name: 'float', precision: { min: 3, max: 1, minInclusive: true, maxInclusive: true } } },  // 5: rule 13
                },
                compositeKeys: [{ columns: ['id'] }],                              // 6: rule 31 (length < 2)
            };
            const a = TV().createConfigBuilder(bad).validate();
            assert(!a.valid, 'invalid');
            assertEq(a.errors.length, 6, 'all six independent defects reported in one pass');
            const paths = a.errors.map((e) => e.path);
            for (const p of ['meta.name', 'resultConfig.maxSamples', 'structure.columnMatching',
                'columns.id.nullable', 'columns.amount.type.precision', 'compositeKeys[0].columns']) {
                assert(paths.includes(p), `reports ${p}`);
            }
            // the ENGINE keeps its abort-on-first fast path: exactly one schemaValidationError,
            // and it is the builder's first error (same rule order)
            const run = TV().validate(bad, { headers: ['id', 'amount'], rows: [] });
            assertEq(run.aborted, true, 'engine aborts');
            const engineErrs = run.summary.details.filter((d) => d.ruleName === 'schemaValidationError');
            assertEq(engineErrs.length, 1, 'engine reports only the first violation');
            assertEq(engineErrs[0].context.path, a.errors[0].path, 'engine first = builder first');

            // fixing defects one by one strictly converges to valid
            const b = TV().createConfigBuilder(bad);
            const fixes = [
                () => b.set('meta.name', 'fixed'),
                () => b.set('resultConfig.maxSamples', 5),
                () => b.set('structure.columnMatching', 'byName'),
                () => b.set('columns.id.nullable', true),
                () => b.set('columns.amount.type.precision', { min: 1, max: 3, minInclusive: true, maxInclusive: true }),
            ];
            let remaining = b.validate().errors.length;
            for (let i = 0; i < 5; i++) {
                fixes[i]();
                const now = b.validate().errors.length;
                assert(now === remaining - 1, `fix ${i + 1}: errors ${remaining} → ${now}`);
                remaining = now;
            }
            // last defect has no per-path setter (array entry) — replace the entry
            const doc = b.build();
            doc.compositeKeys = [{ columns: ['id', 'amount'] }];
            const finalA = TV().createConfigBuilder(doc).validate();
            assert(finalA.valid && finalA.errors.length === 0, 'converged to valid');
        },
    });

    U.push({
        suite, name: 'builder: exhaustive errors cover the comparison section too (C-rules)',
        fn: ({ assert, assertEq }) => {
            const s = cleanSchema();
            s.comparison = {
                match: { keys: ['nope'], setMode: 'diagonal' },                    // C1 + C2
                severity: { exact: 'none' },                                       // C6 (exact not configurable)
                scope: { column: 'id' },                                           // C7 (no value lists)
            };
            const a = TV().createConfigBuilder(s).validate();
            assert(!a.valid, 'invalid');
            const paths = a.errors.map((e) => e.path);
            for (const p of ['comparison.match.keys', 'comparison.match.setMode',
                'comparison.severity.exact', 'comparison.scope']) {
                assert(paths.includes(p), `reports ${p}`);
            }
            assertEq(a.errors.length, 4, 'all four comparison defects in one pass');
        },
    });

    U.push({
        suite, name: 'builder: sparse build(), canonical ordering, round-trip identity (rule M7)',
        fn: ({ assert, assertEq }) => {
            const b = TV().createConfigBuilder()
                .set('meta.name', 'orders')
                .set('evaluation.strictType', false)
                .addColumn('id', { type: { name: 'int' } })
                .addColumn('day', { nullable: true, type: { name: 'date', formats: ['dd.MM.yyyy'] } });
            const out = b.build();
            // sparse: only what was authored — no defaults baked in
            assertEq(out.resultConfig, undefined, 'unset sections absent');
            assertEq(out.columns.id.nullable, undefined, 'unset column keys absent');
            // canonical §4 section order and column insertion order
            assertEq(Object.keys(out), ['meta', 'evaluation', 'columns'], 'top-level order');
            assertEq(Object.keys(out.columns), ['id', 'day'], 'column insertion order preserved');
            assertEq(Object.keys(out.columns.day), ['nullable', 'type'], '§11 key order inside a column');
            // round-trip identity
            const rt = TV().createConfigBuilder(out).build();
            assertEq(rt, out, 'createConfigBuilder(b.build()).build() ≡ b.build()');
            // resolvedPreview: defaults + effective values, inspection-only, idempotent
            const rp = b.resolvedPreview();
            assertEq(rp.evaluation.strictType, false, 'authored value kept');
            assertEq(rp.structure.columnMatching, 'byName', 'default applied');
            assertEq(rp.columns.id.required, true, 'effective required derived (NOT allowMissingColumns)');
            assertEq(rp.columns.id.evaluation.strictType, false, 'override resolution: no null overrides remain');
            assertEq(TV().createConfigBuilder(rp).resolvedPreview(), rp, 'resolution is idempotent');
            assert(TV().createConfigBuilder(rp).validate().valid, 'resolved preview is itself a valid config');
        },
    });

    U.push({
        suite, name: 'builder: unknown paths rejected (rule M8); seed never mutated',
        fn: ({ assert, assertThrows }) => {
            const b = TV().createConfigBuilder(cleanSchema());
            assertThrows(() => b.set('meta.nmae', 'x'), 'TableValidationConfigError', 'misspelled path');
            assertThrows(() => b.set('columns.id.typ.name', 'int'), 'TableValidationConfigError', 'bad column subpath');
            assertThrows(() => b.set('nonsense', 1), 'TableValidationConfigError', 'unknown top-level');
            const seed = cleanSchema();
            const frozen = JSON.parse(JSON.stringify(seed));
            const b2 = TV().createConfigBuilder(seed);
            b2.set('meta.name', 'changed').addColumn('extra', { type: { name: 'skip' } });
            assert(JSON.stringify(seed) === JSON.stringify(frozen), 'seed deep-copied, not mutated');
        },
    });

    U.push({
        suite, name: 'builder: column ops, comparison section, intendedUse',
        fn: ({ assert, assertEq }) => {
            const b = TV().createConfigBuilder(cleanSchema());
            b.addColumn('z', { type: { name: 'skip' } }).moveColumn('z', 0);
            assertEq(Object.keys(b.build().columns), ['z', 'id', 'amount'], 'moveColumn reorders');
            b.removeColumn('z');
            assertEq(Object.keys(b.build().columns), ['id', 'amount'], 'removeColumn');
            // comparison-ness is exactly section presence (Addendum §A.4 point 3)
            assertEq(b.validate({ intendedUse: 'compare' }).valid, false, 'compare intent without section → C1 error');
            b.setComparison({ match: { keys: ['id'] } });
            assert(b.validate().valid, 'minimal comparison section valid (intendedUse defaults to both)');
            b.setComparison(null);
            assertEq(b.build().comparison, undefined, 'setComparison(null) removes the section');
            assert(b.validate({ intendedUse: 'validate' }).valid, 'validation-only config first-class');
            // get/unset
            b.set('resultConfig.maxSamples', 9);
            assertEq(b.get('resultConfig.maxSamples'), 9, 'get reads authored value');
            b.unset('resultConfig.maxSamples');
            assertEq(b.get('resultConfig.maxSamples'), undefined, 'unset restores engine default');
        },
    });

    U.push({
        suite, name: 'resolvedPreview fills and preserves twoDigitYearPivot (1.3.1)',
        fn: ({ assertEq }) => {
            const seed = () => ({
                meta: { schemaVersion: '1.0.0', name: 'pv' },
                columns: { d: { type: { name: 'date', formats: ['dd/MM/yy'] } } },
            });
            // no pivot anywhere → the §5.4 default appears in the preview
            const rp0 = TV().createConfigBuilder(seed()).resolvedPreview();
            assertEq(rp0.evaluation.twoDigitYearPivot, 1961, 'default pivot filled');
            // table-level pivot survives
            const s1 = seed();
            s1.evaluation = { strictType: true, timezone: 'utc', twoDigitYearPivot: 1900 };
            assertEq(TV().createConfigBuilder(s1).resolvedPreview().evaluation.twoDigitYearPivot, 1900,
                'authored table-level pivot kept');
            // column-level pivot survives into the column evaluation (pre-1.3.1: silently dropped)
            const s2 = seed();
            s2.columns.d.evaluation = { twoDigitYearPivot: 1930 };
            const rp2 = TV().createConfigBuilder(s2).resolvedPreview();
            assertEq(rp2.columns.d.evaluation.twoDigitYearPivot, 1930, 'column pivot preserved');
            assertEq(rp2.columns.d.evaluation.strictType, true, 'strictType still resolved alongside');
        },
    });
})();
