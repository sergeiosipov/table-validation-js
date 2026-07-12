/* Unit tests — the comparison engine (compare()), Core §15. */
'use strict';
(function () {
    const U = (name, fn, extra) => window.__UNIT__.push(Object.assign({ suite: 'comparison', name, fn }, extra));
    const TV = () => window.TableValidation;
    const META = { schemaVersion: '1.0.0', name: 'cmp' };

    // base schema: id (int key) + name (string) + amount (float)
    const baseSchema = (comparison) => ({
        meta: META,
        resultConfig: { collectCellRegister: true },
        evaluation: { strictType: false, timezone: 'utc' },
        structure: { columnMatching: 'byName' },
        columns: {
            id: { type: { name: 'int' } },
            name: { type: { name: 'string' } },
            amount: { type: { name: 'float' } },
        },
        comparison,
    });
    const T = (rows) => ({ headers: ['id', 'name', 'amount'], rows });

    U('compare — result shape: engine, diff, rowsChecked, aborted=false', (t) => {
        const schema = baseSchema({ match: { keys: ['id'] } });
        const r = TV().compare(schema, T([['1', 'a', '1.0']]), T([['1', 'a', '1.0']]));
        t.assertEq(r.engine, 'compare', 'engine tag');
        t.assertEq(r.specVersion, '1.2.0', 'specVersion');
        t.assert(!!r.diff && Array.isArray(r.diff.rows), 'diff.rows present');
        t.assertEq(r.aborted, false, 'not aborted');
        t.assertEq(r.summary.rowsChecked, 1, 'rowsChecked = |diff.rows|');
        t.assert('columnsChecked' in r.summary, 'columnsChecked present (buildReport compat)');
        t.assertEq(r.summary.rowsMatched, 1, 'one matched');
        t.assertEq(r.valid, true, 'identical tables valid');
    });

    U('compare — exact vs interpretedMatch vs different tiers', (t) => {
        const schema = baseSchema({
            match: { keys: ['id'] },
            severity: { interpretedMatch: 'warning', valueMismatch: 'error' },
        });
        // row 1: amount "1.0" vs 1 → interpreted equal, raw differ → interpretedMatch (warning)
        // row 2: name "x" vs "y" → valueMismatch (error)
        const r = TV().compare(schema,
            T([['1', 'x', '1.0'], ['2', 'x', '5']]),
            T([['1', 'x', '1'], ['2', 'y', '5']]));
        t.assertEq(r.valid, false, 'has an error');
        t.assertEq(r.summary.bySeverity.error, 1, 'one valueMismatch error');
        t.assertEq(r.summary.bySeverity.warning, 1, 'one interpretedMatch warning');
        const cellsR1 = r.diff.rows.find((rd) => rd.matchKey[0][1] === 1);
        t.assertEq(cellsR1.cells.amount.tier, 'interpretedMatch', 'amount interpretedMatch');
        t.assertEq(cellsR1.cells.amount.rollup, 'equivalent', 'rollup equivalent');
    });

    U('compare — toleranceMatch: within tolerance, not interpreted-equal', (t) => {
        const schema = baseSchema({
            match: { keys: ['id'] },
            fields: { amount: { tolerance: 0.05 } },
            severity: { toleranceMatch: 'warning', valueMismatch: 'error' },
        });
        const r = TV().compare(schema, T([['1', 'x', '1.02']]), T([['1', 'x', '1.00']]));
        const rd = r.diff.rows[0];
        t.assertEq(rd.cells.amount.tier, 'toleranceMatch', 'within tolerance');
        t.assert(Math.abs(rd.cells.amount.delta - 0.02) < 1e-9, 'delta recorded');
        t.assertEq(r.summary.bySeverity.warning, 1, 'toleranceMatch → warning per config');
    });

    U('compare — setMode governs orphans (superset suppresses rowUnexpected)', (t) => {
        const exact = TV().compare(baseSchema({ match: { keys: ['id'], setMode: 'exact' } }),
            T([['1', 'a', '1'], ['2', 'b', '2']]), T([['1', 'a', '1']]));
        t.assertEq(exact.summary.bySeverity.error, 1, 'exact: extra produced row is rowUnexpected error');
        t.assertEq(exact.aborted, false, 'exact not aborted');

        const superset = TV().compare(baseSchema({ match: { keys: ['id'], setMode: 'superset' } }),
            T([['1', 'a', '1'], ['2', 'b', '2']]), T([['1', 'a', '1']]));
        t.assertEq(superset.summary.bySeverity.error, 0, 'superset: extra produced row tolerated');
        t.assertEq(superset.valid, true, 'superset valid');
    });

    U('compare — rowMissing / rowUnexpected in diff', (t) => {
        const r = TV().compare(baseSchema({ match: { keys: ['id'] } }),
            T([['1', 'a', '1'], ['3', 'c', '3']]),
            T([['1', 'a', '1'], ['2', 'b', '2']]));
        const missing = r.diff.rows.find((rd) => rd.status === 'missing');
        const unexpected = r.diff.rows.find((rd) => rd.status === 'unexpected');
        t.assert(!!missing, 'has a missing row (id 2)');
        t.assert(!!unexpected, 'has an unexpected row (id 3)');
        t.assertEq(r.summary.rowsMissing, 1, 'rowsMissing');
        t.assertEq(r.summary.rowsUnexpected, 1, 'rowsUnexpected');
    });

    U('compare — duplicateMatchKey aborts', (t) => {
        const r = TV().compare(baseSchema({ match: { keys: ['id'] } }),
            T([['1', 'a', '1'], ['1', 'b', '2']]), T([['1', 'a', '1']]));
        t.assertEq(r.aborted, true, 'aborted');
        t.assertEq(r.abortReason, 'duplicateMatchKey', 'abortReason');
        t.assertEq(r.valid, false, 'invalid');
    });

    U('compare — severity none keeps outcome in diff but no entry', (t) => {
        const schema = baseSchema({
            match: { keys: ['id'] },
            severity: { interpretedMatch: 'none' },
        });
        const r = TV().compare(schema, T([['1', 'x', '1.0']]), T([['1', 'x', '1']]));
        t.assertEq(r.summary.bySeverity.warning, 0, 'no entry for none-tier');
        t.assertEq(r.diff.rows[0].cells.amount.tier, 'interpretedMatch', 'fact still in diff');
        t.assertEq(r.valid, true, 'valid');
    });

    U('compare — fuzzy key pairing + fuzzyKeyMatch warning', (t) => {
        const schema = {
            meta: META, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' },
            structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'string' } }, name: { type: { name: 'string' } } },
            comparison: {
                match: {
                    keys: ['id', 'name'],
                    fuzzy: { components: ['name'], threshold: 0.6, metric: 'tokenizedFuzzy' },
                },
                severity: { fuzzyKeyMatch: 'warning' },
            },
        };
        const H = (rows) => ({ headers: ['id', 'name'], rows });
        const r = TV().compare(schema,
            H([['1', 'Acme Corporation']]),
            H([['1', 'Acme Corp']]));
        const rd = r.diff.rows[0];
        t.assertEq(rd.status, 'fuzzyMatched', 'paired fuzzily');
        t.assert(rd.similarity > 0.6, 'similarity above threshold');
        t.assertEq(r.summary.bySeverity.warning >= 1, true, 'fuzzyKeyMatch warning recorded');
    });

    U('compare — diffChecks orphanRateMax gates', (t) => {
        const schema = baseSchema({
            match: { keys: ['id'], setMode: 'subset' },   // missing expected allowed as orphans
            diffChecks: { table: [{ name: 'budget', type: 'orphanRateMax', severity: 'error', params: { max: 0.4, side: 'expected' } }] },
        });
        // 1 of 2 expected missing → rate 0.5 > 0.4 → error
        const r = TV().compare(schema, T([['1', 'a', '1']]), T([['1', 'a', '1'], ['2', 'b', '2']]));
        t.assertEq(r.summary.bySeverity.error >= 1, true, 'orphanRateMax fired');
        t.assert(r.diff.tableCheckFails.some((f) => f.name === 'budget'), 'recorded in tableCheckFails');
    });

    U('compare — config error aborts with schemaInvalid (unknown key column)', (t) => {
        const schema = baseSchema({ match: { keys: ['nope'] } });
        const r = TV().compare(schema, T([['1', 'a', '1']]), T([['1', 'a', '1']]));
        t.assertEq(r.aborted, true, 'aborted');
        t.assertEq(r.abortReason, 'schemaInvalid', 'schemaInvalid');
    });

    U('compare — throws TableValidationConfigError on bad args', (t) => {
        t.assertThrows(() => TV().compare(baseSchema({ match: { keys: ['id'] } }), 'x', T([])), 'TableValidationConfigError', 'bad produced');
        t.assertThrows(() => TV().compare(baseSchema({ match: { keys: ['id'] } }), T([]), { rows: 'x' }), 'TableValidationConfigError', 'bad expected rows');
    });

    U('compare — expectedName: expected table carries a column under a different header', (t) => {
        const schema = baseSchema({
            match: { keys: ['id'] },
            fields: { amount: { expectedName: 'Betrag' } },
        });
        const expected = { headers: ['id', 'name', 'Betrag'], rows: [['1', 'x', '2'], ['2', 'x', '5']] };
        const r = TV().compare(schema, T([['1', 'x', '1'], ['2', 'x', '5']]), expected);
        t.assertEq(r.aborted, false, 'no abort');
        t.assertEq(r.summary.bySeverity.error, 1, 'amount 1 vs 2 is a valueMismatch');
        const rd = r.diff.rows.find((x) => x.matchKey[0][1] === 1);
        t.assertEq(rd.cells.amount.tier, 'valueMismatch', 'diff keyed by the LOGICAL name');
        t.assertEq(rd.cells.amount.expected, '2', 'expected cell read via the alias');
        const entry = r.cellRegister.find((e) => e.ruleName === 'valueMismatch');
        t.assertEq(entry.field, 'amount', 'register keeps the logical (schema) name');
        // alias on a key column: pairing itself uses the alias on the expected side
        const keyed = baseSchema({ match: { keys: ['id'] }, fields: { id: { expectedName: 'ID Nr' } } });
        const exp2 = { headers: ['ID Nr', 'name', 'amount'], rows: [['1', 'x', '1']] };
        const r2 = TV().compare(keyed, T([['1', 'x', '1']]), exp2);
        t.assertEq(r2.summary.rowsMatched, 1, 'rows pair via the aliased key');
        t.assertEq(r2.valid, true, 'clean');
        // without the alias the column is only on one side
        const r3 = TV().compare(baseSchema({ match: { keys: ['id'] } }),
            T([['1', 'x', '1']]), exp2);
        t.assert(r3.summary.details.some((d) => d.ruleName === 'columnOnlyOnOneSide'), 'sanity: alias was load-bearing');
    });

    U('compare — expectedName is inert (advisory) under byPosition matching', (t) => {
        const schema = baseSchema({ match: { keys: ['id'] }, fields: { amount: { expectedName: 'zz' } } });
        schema.structure = { columnMatching: 'byPosition' };
        const r = TV().compare(schema,
            { headers: null, rows: [['1', 'x', '1']] }, { headers: null, rows: [['1', 'x', '1']] });
        t.assertEq(r.valid, true, 'positional match unaffected by the alias');
        const adv = r.summary.details.find((d) => d.ruleName === 'irrelevantSetting');
        t.assertEq(adv && adv.context.setting, 'comparison.fields.amount.expectedName', 'advisory emitted');
    });

    U('compare — onDuplicateKey default ("abort") is unchanged: intrinsic abort', (t) => {
        const schema = baseSchema({ match: { keys: ['id'] } });
        const r = TV().compare(schema, T([['1', 'a', '1'], ['1', 'b', '2']]), T([['1', 'a', '1']]));
        t.assertEq(r.aborted, true, 'aborted');
        t.assertEq(r.abortReason, 'duplicateMatchKey', 'intrinsic reason');
        t.assertEq(r.valid, false, 'invalid');
    });

    U('compare — onDuplicateKey "reportAndExclude": one violation per group, rows excluded, run continues', (t) => {
        const schema = baseSchema({ match: { keys: ['id'], onDuplicateKey: 'reportAndExclude' } });
        // produced: id 1 duplicated (twice), id 2 unique-with-mismatch, id 3 unique-clean
        // expected: id 1 once (poisoned key → also excluded), id 2, id 3
        const r = TV().compare(schema,
            T([['1', 'a', '1'], ['1', 'b', '2'], ['2', 'x', '9'], ['3', 'y', '3']]),
            T([['1', 'a', '1'], ['2', 'x', '5'], ['3', 'y', '3']]));
        t.assertEq(r.aborted, false, 'no abort under the opt-in policy');
        const dupDetail = r.summary.details.find((d) => d.ruleName === 'duplicateMatchKey');
        t.assertEq(dupDetail.count, 1, 'ONE violation for the duplicated key group');
        t.assertEq(dupDetail.severity, 'error', 'default severity error');
        t.assertEq(dupDetail.context.rows, [0, 1], 'group rows in context');
        t.assertEq(dupDetail.context.policy, 'reportAndExclude', 'policy tagged');
        // all rows carrying the key are excluded on BOTH sides (key-global exclusion)
        const excl = r.diff.rows.filter((x) => x.status === 'excludedDuplicateKey');
        t.assertEq(excl.length, 3, 'two produced + one expected row excluded');
        t.assert(excl.every((x) => Object.keys(x.cells).length === 0), 'excluded rows are not cell-compared');
        t.assertEq(r.summary.rowsExcluded, 3, 'summary.rowsExcluded');
        // no rowMissing/rowUnexpected for the poisoned key; the rest of the run proceeds
        t.assert(!r.summary.details.some((d) => d.ruleName === 'rowMissing' || d.ruleName === 'rowUnexpected'),
            'excluded ≠ orphaned');
        t.assertEq(r.summary.rowsMatched, 2, 'ids 2 and 3 still pair');
        t.assert(r.summary.details.some((d) => d.ruleName === 'valueMismatch'), 'id 2 mismatch still found');
        t.assertEq(r.summary.rowsChecked, r.diff.rows.length, 'rowsChecked = |diff.rows| incl. excluded');
        // severity map applies: none → excluded silently, but the diff still records the fact
        const silent = TV().compare(baseSchema({
            match: { keys: ['id'], onDuplicateKey: 'reportAndExclude' },
            severity: { duplicateMatchKey: 'none' },
        }), T([['1', 'a', '1'], ['1', 'b', '2']]), T([['1', 'a', '1']]));
        t.assert(!silent.summary.details.some((d) => d.ruleName === 'duplicateMatchKey'), 'none → no entry');
        t.assertEq(silent.diff.rows.filter((x) => x.status === 'excludedDuplicateKey').length, 3,
            'fact layer stays complete');
        t.assertEq(silent.valid, true, 'none does not gate');
    });

    U('compare — duplicateMatchKey severity under "abort" policy is a dead knob (advisory)', (t) => {
        const schema = baseSchema({ match: { keys: ['id'] }, severity: { duplicateMatchKey: 'warning' } });
        const r = TV().compare(schema, T([['1', 'a', '1']]), T([['1', 'a', '1']]));
        const adv = r.summary.details.find((d) => d.ruleName === 'irrelevantSetting');
        t.assertEq(adv && adv.context.setting, 'comparison.severity.duplicateMatchKey', 'advisory emitted');
        // and the abort, when it fires, is still error + aborted regardless of the mapping
        const dup = TV().compare(schema, T([['1', 'a', '1'], ['1', 'b', '2']]), T([['1', 'a', '1']]));
        t.assertEq(dup.abortReason, 'duplicateMatchKey', 'abort not downgradable');
    });
})();
