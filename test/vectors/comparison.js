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
        t.assertEq(r.specVersion, TV().SPEC_VERSION, 'specVersion');
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

    // ---------------- v1.3.1 regression vectors ----------------

    // scoped schema: id (int key) + region (scope column) + amount (float)
    const scopedSchema = (scope) => ({
        meta: META, resultConfig: { collectCellRegister: true },
        evaluation: { strictType: false, timezone: 'utc' },
        structure: { columnMatching: 'byName' },
        columns: {
            id: { type: { name: 'int' } },
            region: { type: { name: 'string' } },
            amount: { type: { name: 'float' } },
        },
        comparison: { match: { keys: ['id'] }, scope },
    });
    const TS = (rows) => ({ headers: ['id', 'region', 'amount'], rows });

    U('scope: compare policy (1.3.1)', (t) => {
        // scoped comparisons crashed outright before v1.3.1 — pin the whole path
        const r = TV().compare(scopedSchema({ column: 'region', inScopeValues: ['EU'] }),
            TS([['1', 'EU', '10'], ['2', 'US', '20']]),
            TS([['1', 'EU', '10'], ['2', 'US', '21']]));
        t.assertEq(r.aborted, false, 'no abort');
        const r1 = r.diff.rows.find((x) => x.matchKey[0][1] === 1);
        const r2 = r.diff.rows.find((x) => x.matchKey[0][1] === 2);
        t.assertEq(r1.inScope, true, 'EU row in scope');
        t.assertEq(r1.cells.amount.rollup, 'equal', 'EU row equal');
        t.assertEq(r2.inScope, false, 'US row tagged out of scope');
        t.assertEq(r2.cells.amount.tier, 'valueMismatch',
            'compare policy still compares (and reports) out-of-scope rows');
        const vm = r.cellRegister.find((e) => e.ruleName === 'valueMismatch');
        t.assertEq(vm.context.inScope, false, 'register entry carries inScope: false');
    });

    U('scope: skip policy excludes rows and denominators (1.3.1)', (t) => {
        const r = TV().compare(scopedSchema({ column: 'region', inScopeValues: ['EU'], outOfScopePolicy: 'skip' }),
            TS([['1', 'EU', '1']]),
            TS([['1', 'EU', '1'], ['2', 'US', '2']]));
        t.assertEq(r.diff.rows.length, 1, 'the skipped US orphan produces NO diff row');
        t.assertEq(r.summary.bySeverity.error, 0, 'zero error entries');
        t.assertEq(r.summary.rowsMissing, 0, 'skipped ≠ missing');
        t.assertEq(r.diff.summary.orphanRateExpected, 0, 'skipped rows leave the denominator too');
        t.assertEq(r.valid, true, 'clean');
    });

    U('reportAndExclude: orphan-rate denominators exclude excluded rows (1.3.1)', (t) => {
        const schema = baseSchema({
            match: { keys: ['id'], onDuplicateKey: 'reportAndExclude' },
            severity: { duplicateMatchKey: 'none' },
        });
        // expected id 1 duplicated → key-global exclusion removes BOTH expected id-1 rows
        // AND the produced id-1 carrier; id 2 is genuinely missing
        const r = TV().compare(schema,
            T([['1', 'x', '1']]),
            T([['1', 'x', '1'], ['1', 'y', '2'], ['2', 'z', '3']]));
        t.assertEq(r.summary.rowsExcluded, 3, 'two expected dups + the produced carrier excluded');
        t.assertEq(r.summary.rowsMissing, 1, 'id 2 missing');
        t.assertEq(r.diff.summary.orphanRateExpected, 1.0,
            'denominator = 3 expected − 2 excluded = 1 (pre-1.3.1: wrongly 1/3)');
    });

    U('comparison default messages render (1.3.1)', (t) => {
        // pre-1.3.1 the register carried the bare rule name as the message
        const r = TV().compare(baseSchema({ match: { keys: ['id'] } }),
            T([['1', 'a', '1']]),
            T([['1', 'a', '2'], ['2', 'b', '5']]));
        const vm = r.cellRegister.find((e) => e.ruleName === 'valueMismatch');
        t.assertEq(vm.message, 'amount: produced "1" ≠ expected "2"',
            'normative §15.10 template; fmtVal JSON-quotes raw string cells');
        t.assert(vm.message !== 'valueMismatch', 'not the pre-1.3.1 bare rule name');
        const rm = r.cellRegister.find((e) => e.ruleName === 'rowMissing');
        t.assert(rm.message.startsWith('Expected row '), 'rowMissing template prefix');
        t.assert(rm.message.includes('has no produced counterpart'), 'rowMissing template body');
    });

    U('maxCandidatePairsExceeded is its own rule name (1.3.1)', (t) => {
        const schema = {
            meta: META, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' },
            structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'string' } }, name: { type: { name: 'string' } } },
            comparison: { match: {
                keys: ['id', 'name'],
                fuzzy: { components: ['name'], threshold: 0.5, maxCandidatePairs: 1 },
            } },
        };
        const H = (rows) => ({ headers: ['id', 'name'], rows });
        // disjoint ids → exact pairing leaves a 2 × 2 residue > maxCandidatePairs
        const r = TV().compare(schema, H([['1', 'aa'], ['2', 'bb']]), H([['3', 'aa'], ['4', 'bb']]));
        t.assertEq(r.aborted, true, 'aborted');
        t.assertEq(r.abortReason, 'maxCandidatePairsExceeded', 'its own abort reason');
        t.assertEq(r.cellRegister.length, 1, 'a single register entry');
        const e = r.cellRegister[0];
        t.assertEq(e.ruleName, 'maxCandidatePairsExceeded', 'own rule name (pre-1.3.1: duplicateMatchKey)');
        t.assertEq(e.context.candidatePairs, 4, 'candidate pairs counted');
        t.assertEq(e.context.maxCandidatePairs, 1, 'configured cap in context');
        t.assert(e.message.includes('candidate pairs exceed maxCandidatePairs'), 'default message renders');
    });

    U('toleranceMatch context carries toleranceSource (1.3.1)', (t) => {
        const mk = (tolerance) => baseSchema({
            match: { keys: ['id'] },
            fields: { amount: { tolerance } },
            severity: { toleranceMatch: 'warning' },
        });
        const abs = TV().compare(mk(0.05), T([['1', 'x', '1.02']]), T([['1', 'x', '1.00']]));
        const ea = abs.cellRegister.find((e) => e.ruleName === 'toleranceMatch');
        t.assertEq(ea.context.toleranceSource, 'absolute', 'numeric spec → absolute');
        t.assertEq(ea.context.field, 'amount', 'field named');
        t.assert(Math.abs(ea.context.delta - 0.02) < 1e-9, 'delta present');
        t.assertEq(ea.context.tolerance, 0.05, 'resolved ε present');
        const rel = TV().compare(mk({ percent: 10, of: 'amount' }), T([['1', 'x', '1.02']]), T([['1', 'x', '1.00']]));
        const er = rel.cellRegister.find((e) => e.ruleName === 'toleranceMatch');
        t.assertEq(er.context.toleranceSource, 'relative:10%@amount', 'percent spec → §15.8 relative tag');
    });

    U('fuzzy contexts complete (1.3.1)', (t) => {
        const schema = {
            meta: META, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' },
            structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'string' } }, name: { type: { name: 'string' } } },
            comparison: {
                match: {
                    keys: ['id', 'name'],
                    fuzzy: { components: ['name'], threshold: 0.5, metric: 'tokenizedFuzzy', ambiguityMargin: 0.5 },
                },
                severity: { fuzzyKeyMatch: 'warning', ambiguousFuzzyMatch: 'warning', rowMissing: 'none' },
            },
        };
        const H = (rows) => ({ headers: ['id', 'name'], rows });
        // three candidates with distinct similarities; the wide margin also fires ambiguity
        const r = TV().compare(schema,
            H([['1', 'Acme Corporation']]),
            H([['1', 'Acme Corp'], ['1', 'Acme Co'], ['1', 'Zeta Industries']]));
        const fk = r.cellRegister.find((e) => e.ruleName === 'fuzzyKeyMatch');
        t.assert(Array.isArray(fk.context.matchKey), 'matchKey is an array, never null');
        t.assertEq(typeof fk.context.similarity, 'number', 'similarity number');
        t.assertEq(typeof fk.context.runnerUpSimilarity, 'number', 'runner-up similarity number');
        t.assertEq(fk.context.components, ['name'], 'components echo the fuzzy config');
        const am = r.cellRegister.find((e) => e.ruleName === 'ambiguousFuzzyMatch');
        t.assertEq(am.context.ambiguityMargin, 0.5, 'ambiguityMargin echoed');
        t.assertEq(am.context.components, ['name'], 'shared context shape');
    });
})();
