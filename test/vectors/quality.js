/* Quality program — prototype-pollution checks (WS6 item 5) and other cross-cutting
 * hardening assertions. Runs in the browser suite and the Node runner. */
'use strict';
(function () {
    const U = window.__UNIT__;
    const suite = 'quality';
    const TV = () => window.TableValidation;

    // The two vectors below were added by the suite-mutation exercise (WS6 item 7):
    // seeded engine bugs the corpus did NOT catch — now it does.

    U.push({
        suite, name: 'int safe-range boundary: a native integral number beyond 2^53−1 is a typeMismatch',
        fn: ({ assertEq }) => {
            const schema = {
                meta: { schemaVersion: '1.0.0', name: 'q' },
                columns: { a: { type: { name: 'int' } } },
            };
            const r = TV().validate(schema, { headers: ['a'], rows: [[9007199254740994], [9007199254740991]] });
            assertEq(r.summary.bySeverity.error, 1, 'exactly the unsafe value fails');
            assertEq(r.summary.details[0].ruleName, 'typeMismatch', 'unsafe integral native number is not an int');
            assertEq(r.summary.details[0].topSampleRows, [0], 'the 2^53+2 row, not the 2^53−1 row');
        },
    });

    U.push({
        suite, name: 'comparison exact tier requires the SAME native kind — "1" vs 1 is interpretedMatch, never exact',
        fn: ({ assertEq }) => {
            const schema = {
                meta: { schemaVersion: '1.0.0', name: 'q' },
                evaluation: { strictType: false, timezone: 'utc' },
                columns: { id: { type: { name: 'int' } }, v: { type: { name: 'int' } } },
                comparison: { match: { keys: ['id'] }, fields: { id: { compare: false } } },
            };
            const r = TV().compare(schema,
                { headers: ['id', 'v'], rows: [['1', '7']] },
                { headers: ['id', 'v'], rows: [[1, 7]] });
            assertEq(r.diff.rows[0].cells.v.tier, 'interpretedMatch',
                'same rendering, different native kind → equivalent (Core §15.4 tier 1 needs kind equality)');
            assertEq(r.diff.rows[0].cells.v.rollup, 'equivalent', 'rollup');
            assertEq(r.summary.bySeverity.warning, 1, 'interpretedMatch default severity is warning');
        },
    });

    U.push({
        suite, name: 'prototype pollution: __proto__/constructor keys never pollute (clone, builder, ingest, compare)',
        fn: async ({ assert, assertEq }) => {
            const evil = '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}}}';
            const clean = () => {
                assert(({}).polluted === undefined, 'Object.prototype.polluted leaked');
                assert(({}).polluted2 === undefined, 'Object.prototype.polluted2 leaked');
            };

            // 1. schema with hostile keys through validate() (jsonClone / resolution paths)
            const schema = {
                meta: { schemaVersion: '1.0.0', name: 'p' },
                columns: { a: { type: { name: 'string' } } },
            };
            // hostile params object reaches jsonClone via the builder seed / custom check params
            const hostileParams = JSON.parse(evil);
            const r = TV().validate(Object.assign({}, schema, {
                customRowChecks: [{ name: 'c', type: 'custom', fn: 'f', params: hostileParams }],
            }), { headers: ['a'], rows: [['x']] }, { functions: { f: () => [] } });
            assert(r.specVersion !== undefined, 'validate ran');
            clean();

            // 2. builder seed + build round-trip with hostile keys inside a params object
            const b = TV().createConfigBuilder(Object.assign({}, schema, {
                customTableChecks: [{ name: 't', type: 'custom', fn: 'g', params: JSON.parse(evil) }],
            }));
            const out = b.build();
            clean();
            assert(!({}).polluted, 'builder build polluted');
            // the hostile key survives as PLAIN DATA (an own property), not as a prototype
            const params = out.customTableChecks[0].params;
            assert(Object.prototype.hasOwnProperty.call(params, '__proto__'), '__proto__ kept as an own data key');
            assert(Object.getPrototypeOf(params) === Object.prototype, 'clone prototype untouched');

            // 3. ingest jsonObjects with hostile record keys
            const ing = await TV().ingest(`[${evil}]`, { format: 'jsonObjects' });
            clean();
            assert(ing.table.headers.includes('__proto__'), 'hostile key becomes an ordinary header');
            assertEq(ing.table.rows.length, 1, 'row emitted');

            // 4. resolvedPreview / canonicalization with hostile keys
            b.resolvedPreview();
            clean();

            // 5. compare() with a hostile params object on a diff check
            const cmp = TV().compare(Object.assign({}, schema, {
                comparison: { match: { keys: ['a'] }, diffChecks: { row: [{ name: 'd', type: 'custom', fn: 'h', params: JSON.parse(evil) }] } },
            }), { headers: ['a'], rows: [['x']] }, { headers: ['a'], rows: [['x']] }, { functions: { h: () => [] } });
            assert(cmp.engine === 'compare', 'compare ran');
            clean();
        },
    });

    U.push({
        suite, name: 'setOwn hardening (1.3.1): a column named "__proto__" flows through summaries, canonicalize, preview, and compare',
        fn: ({ assert, assertEq }) => {
            // JSON.parse is the only reliable way to get "__proto__" as an OWN key
            const mkCfg = () => JSON.parse('{"meta":{"schemaVersion":"1.0.0","name":"p"},' +
                '"resultConfig":{"collectCellRegister":true},' +
                '"evaluation":{"strictType":false,"timezone":"utc"},' +
                '"columns":{"__proto__":{"type":{"name":"int"}}},' +
                '"comparison":{"match":{"keys":["__proto__"]}}}');
            const own = (o) => Object.prototype.hasOwnProperty.call(o, '__proto__');
            const clean = () => assert(({}).polluted === undefined, 'Object.prototype polluted');
            assert(own(mkCfg().columns), 'fixture sanity: JSON.parse yields an own key');

            // (a) validate() a failing table → own byColumn key, intact prototype, no pollution
            const r = TV().validate(mkCfg(), { headers: ['__proto__'], rows: [['x']] });
            assertEq(r.valid, false, 'typeMismatch fires on the hostile-named column');
            assert(own(r.summary.byColumn), 'summary.byColumn carries the OWN key');
            assertEq(r.summary.byColumn['__proto__'].error, 1, 'counts land under it');
            assert(Object.getPrototypeOf(r.summary.byColumn) === Object.prototype, 'byColumn prototype not corrupted');
            clean();

            // (b) canonical form (createConfigBuilder(cfg).build() ≡ canonicalizeConfig)
            const out = TV().createConfigBuilder(mkCfg()).build();
            assert(own(out.columns), 'canonicalized columns keep the own key');
            assert(Object.getPrototypeOf(out.columns) === Object.prototype, 'canonical columns prototype intact');
            clean();

            // (c) resolvedPreview
            const rp = TV().createConfigBuilder(mkCfg()).resolvedPreview();
            assert(own(rp.columns), 'resolvedPreview keeps the own key');
            assert(Object.getPrototypeOf(rp.columns) === Object.prototype, 'preview columns prototype intact');
            clean();

            // (d) compare() with the column keyed AND compared → own key on each diff row's cells
            const cmp = TV().compare(mkCfg(),
                { headers: ['__proto__'], rows: [['1']] }, { headers: ['__proto__'], rows: [['1']] });
            assertEq(cmp.aborted, false, 'compare runs');
            assert(cmp.diff.rows.length === 1 && cmp.diff.rows.every((rd) => own(rd.cells)),
                'diff row cells carry the own key');
            clean();
        },
    });
})();
