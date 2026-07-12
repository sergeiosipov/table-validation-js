/* Quality program — mutation-based builder/engine parity (WS6 item 3).
 *
 * For every configModel descriptor: inject a wrong-type / out-of-enum /
 * broken-dependency value into a known-valid config, then assert that
 *   (a) the BUILDER reports the config invalid,
 *   (b) the owning ENGINE (per descriptor.engines) aborts with schemaInvalid, and
 *   (c) the engine's offending path is among the builder's (exhaustive) paths.
 * A small whitelist documents the descriptors a single-value mutation cannot
 * invalidate (no silent caps — an unexpected skip fails the test).
 */
'use strict';
(function () {
    const U = window.__UNIT__;
    const suite = 'mutation';
    const TV = () => window.TableValidation;

    const clone = (v) => JSON.parse(JSON.stringify(v));

    // known-valid base instantiating every context a descriptor can live in
    function baseConfig() {
        return {
            meta: { schemaVersion: '1.0.0', name: 'mut', description: 'base' },
            resultConfig: { maxSamples: 5 },
            nullHandling: { nullEquivalents: [''] },
            evaluation: { strictType: false, timezone: 'utc' },
            structure: { columnMatching: 'byName' },
            columns: {
                cStr: { type: { name: 'string', regex: '^[a-z]+$' } },
                cInt: { type: { name: 'int' } },
                cFlt: { type: { name: 'float' } },
                cBool: { type: { name: 'bool' } },
                cDt: { type: { name: 'datetime', formats: ['yyyy-MM-dd HH:mm'] } },
                cDate: { type: { name: 'date', formats: ['yyyy-MM-dd'] } },
                cTime: { type: { name: 'time', formats: ['HH:mm'] } },
                cCat: { type: { name: 'categorical', allowedValues: ['A', 'B'] } },
                cSkip: { type: { name: 'skip' } },
            },
            compositeKeys: [{ columns: ['cStr', 'cInt'] }],
            customRowChecks: [{ name: 'rc', type: 'comparison', fieldA: 'cInt', fieldB: 'cFlt', op: '<' }],
            customTableChecks: [{ name: 'tc', type: 'sumEquals', fields: ['cInt'], expectedValue: 10 }],
            comparison: {
                match: { keys: ['cInt'], fuzzy: { components: ['cStr'], threshold: 0.9 } },
                fields: { cStr: { compare: true } },
                scope: { column: 'cCat', inScopeValues: ['A'] },
                diffChecks: {
                    row: [{ name: 'r1', type: 'custom', fn: 'f' }],
                    table: [{ name: 't1', type: 'orphanRateMax', params: { max: 0.5, side: 'either' } }],
                },
            },
        };
    }
    const FUNCTIONS = { f: () => [] };

    // per-path context adjustments so the mutated setting is actually evaluated
    const CONTEXT = {
        'customRowChecks[].if': (c) => { c.customRowChecks[0] = { name: 'rc', type: 'conditionalRequired', if: { field: 'cInt', op: '>', value: 0 }, then: { field: 'cStr', nonNull: true } }; },
        'customRowChecks[].then': (c) => CONTEXT['customRowChecks[].if'](c),
        'customRowChecks[].fields': (c) => { c.customRowChecks[0] = { name: 'rc', type: 'nonNullCount', fields: ['cStr', 'cInt'], expected: 1 }; },
        'customRowChecks[].expected': (c) => CONTEXT['customRowChecks[].fields'](c),
        'customRowChecks[].fn': (c) => { c.customRowChecks[0] = { name: 'rc', type: 'custom', fn: 'f' }; },
        'customRowChecks[].params': (c) => CONTEXT['customRowChecks[].fn'](c),
        'customTableChecks[].field': (c) => { c.customTableChecks[0] = { name: 'tc', type: 'monotonic', field: 'cInt', direction: 'increasing' }; },
        'customTableChecks[].direction': (c) => CONTEXT['customTableChecks[].field'](c),
        'customTableChecks[].start': (c) => { c.customTableChecks[0] = { name: 'tc', type: 'sequenceNoGaps', field: 'cInt', start: 1 }; },
        'customTableChecks[].expectedFieldRow': (c) => { c.customTableChecks[0] = { name: 'tc', type: 'sumEquals', fields: ['cInt'], expectedField: 'cFlt', expectedFieldRow: 'first' }; },
        'customTableChecks[].fn': (c) => { c.customTableChecks[0] = { name: 'tc', type: 'custom', fn: 'f' }; },
        'customTableChecks[].params': (c) => CONTEXT['customTableChecks[].fn'](c),
        'comparison.diffChecks.table[].params': (c) => { /* base table[0] is orphanRateMax — params ARE validated */ },
        'comparison.diffChecks.table[].fn': (c) => { c.comparison.diffChecks.table[0] = { name: 't1', type: 'custom', fn: 'f' }; },
    };

    // custom mutations where the generic wrong-type value would not break the rule
    const CUSTOM_MUTATION = {
        'comparison.match.keys': [],
        'comparison.match.fuzzy.components': [],
        'comparison.scope.inScopeValues': [],
        'comparison.scope.outOfScopeValues': ['B'],   // both lists non-empty → C7 "not both"
        'compositeKeys[].columns': ['cStr'],          // length 1 → rule 31
        'bool.trueValues': [],
        'bool.falseValues': [],
        'categorical.allowedValues': [],
        'customTableChecks[].expectedField': 'cFlt',  // both expectedValue and expectedField → rule 36
    };

    // descriptors a single-value mutation cannot invalidate, with the reason
    const SKIP = {
        'comparison.diffChecks.row[].params': 'custom diff-check params are opaque (passed through, never shape-checked)',
        'comparison.match.fuzzy.metric': null,        // enum — handled generically; placeholder removed below
    };
    delete SKIP['comparison.match.fuzzy.metric'];

    function mutationFor(desc) {
        const key = desc.path.replace(/^columns\.<name>\.type\./, (m) => desc.section.startsWith('type:') ? desc.section.slice(5) + '.' : m);
        if (key in CUSTOM_MUTATION) return { value: CUSTOM_MUTATION[key] };
        if (desc.path in CUSTOM_MUTATION) return { value: CUSTOM_MUTATION[desc.path] };
        if (desc.enum) return { value: '~~out-of-enum~~' };
        const t = desc.type;
        if (t === 'bool' || t === 'bool|null') return { value: 'yes' };
        if (t === 'int' || t === 'int|null' || t === 'number' || t === 'number|null') return { value: 'not-a-number' };
        if (t === 'string' || t === 'string|null') return { value: 12345 };
        if (t === 'string[]' || t === 'string[]|null') return { value: 'not-an-array' };
        if (t === 'any[]') return { value: 'not-an-array' };
        if (t.startsWith('Range')) return { value: { min: 9, max: 1, minInclusive: true, maxInclusive: true } };
        if (t === 'StringMatchStrategy') return { value: { caseSensitive: 'x', trim: true, stripSpaces: false } };
        if (t.startsWith('NumberFormat[]')) return { value: [{ decimalSeparator: '99', groupingSeparators: [] }] };
        if (t === 'Severity') return { value: 'halt' };
        if (t.startsWith('ToleranceSpec')) return { value: -1 };
        if (t.startsWith('FuzzyKeySpec')) return { value: 'not-a-spec' };
        if (t.startsWith('CellFuzzySpec')) return { value: { threshold: 7 } };
        if (t === 'number|map') return { value: 0 };
        if (t === 'object' || t === 'object|null') return { value: 'not-an-object' };
        if (t === '"first"|"last"|int') return { value: 'middle' };
        return null;
    }

    function concretize(desc) {
        let p = desc.path;
        const bySection = {
            'type:string': 'cStr', 'type:int': 'cInt', 'type:float': 'cFlt', 'type:bool': 'cBool',
            'type:datetime': 'cDt', 'type:date': 'cDate', 'type:time': 'cTime',
            'type:categorical': 'cCat', 'type:skip': 'cSkip',
        };
        let col = bySection[desc.section] || 'cStr';
        if (p === 'comparison.fields.<col>.tolerance') col = 'cInt';
        p = p.replace(/<name>|<col>/g, col).replace(/\[\]/g, '[0]').replace(/<rule>/g, 'rowCountBreach');
        return p;
    }

    function setPath(obj, path, value) {
        const segs = path.split('.').flatMap((raw) => {
            const m = /^([^[\]]+)((\[\d+\])*)$/.exec(raw);
            const out = [m[1]];
            for (const idx of (m[2].match(/\d+/g) || [])) out.push(Number(idx));
            return out;
        });
        let node = obj;
        for (let i = 0; i < segs.length - 1; i++) {
            const k = segs[i];
            if (node[k] === undefined || node[k] === null) node[k] = typeof segs[i + 1] === 'number' ? [] : {};
            node = node[k];
        }
        node[segs[segs.length - 1]] = value;
    }

    U.push({
        suite, name: 'builder/engine parity over every configModel descriptor (wrong-type/out-of-enum/broken-dependency injections)',
        needsLuxon: true,
        fn: ({ assert, assertEq }) => {
            // the base itself must be clean on both sides
            const base = baseConfig();
            const baseAuth = TV().createConfigBuilder(base).validate({ functions: FUNCTIONS });
            assert(baseAuth.valid, 'base config authoring-valid: ' + JSON.stringify(baseAuth.errors));
            const headers = Object.keys(base.columns);
            const table = { headers, rows: [] };
            const baseRun = TV().compare(base, table, table, { functions: FUNCTIONS });
            assert(!baseRun.aborted, 'base config engine-clean');

            const skipped = [];
            let mutated = 0;
            for (const desc of TV().configModel.settings) {
                if (desc.path in SKIP) { skipped.push(desc.path); continue; }
                const mut = mutationFor(desc);
                if (mut === null) { skipped.push(desc.path + ' (no mutation for type ' + desc.type + ')'); continue; }

                const cfg = baseConfig();
                const ctx = CONTEXT[desc.path];
                if (ctx) ctx(cfg);
                const concrete = concretize(desc);
                setPath(cfg, concrete, clone(mut.value));

                // (a) builder rejects
                const a = TV().createConfigBuilder(cfg).validate({ functions: FUNCTIONS });
                assert(!a.valid, `${desc.path}: builder accepted the mutation at ${concrete} = ${JSON.stringify(mut.value)}`);

                // (b) the owning engine aborts schemaInvalid
                const engine = desc.engines.includes('validate') ? 'validate' : 'compare';
                const res = engine === 'validate'
                    ? TV().validate(cfg, table, { functions: FUNCTIONS })
                    : TV().compare(cfg, table, table, { functions: FUNCTIONS });
                assertEq(res.abortReason, 'schemaInvalid', `${desc.path} (${engine}): expected a schemaInvalid abort`);

                // (c) same offending path: the engine's (first) error is among the builder's
                const engineErr = res.summary.details.find((d) => d.ruleName === 'schemaValidationError');
                const enginePath = engineErr && engineErr.context.path;
                assert(a.errors.some((e) => e.path === enginePath),
                    `${desc.path}: engine path "${enginePath}" not among builder paths ${JSON.stringify(a.errors.map((e) => e.path))}`);
                // and the reported defect anchors at the mutated setting — or at a sibling
                // in the same entry/object (cross-setting rules like 36 report at their own
                // canonical path, e.g. expectedValue for the expectedValue/expectedField XOR)
                const parent = concrete.replace(/\.[^.]+$/, '');
                assert(a.errors.some((e) => e.path.startsWith(concrete) || concrete.startsWith(e.path) || e.path.startsWith(parent)),
                    `${desc.path}: no builder error anchored at ${concrete}: ${JSON.stringify(a.errors.map((e) => e.path))}`);
                mutated++;
            }

            // no silent caps: every skip is deliberate and listed here
            const expectedSkips = ['comparison.diffChecks.row[].params'];
            assertEq(skipped, expectedSkips, 'only the documented descriptors are skipped');
            assert(mutated >= TV().configModel.settings.length - expectedSkips.length,
                `covered ${mutated}/${TV().configModel.settings.length} descriptors`);
        },
    });
})();
