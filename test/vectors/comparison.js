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

    U('compare — setMode subset (produced⊆expected): rowMissing none, rowUnexpected error', (t) => {
        // B111: mirrors the exact/superset test above for the untested subset branch.
        const r = TV().compare(baseSchema({ match: { keys: ['id'], setMode: 'subset' } }),
            T([['1', 'a', '1'], ['3', 'c', '3']]), T([['1', 'a', '1'], ['2', 'b', '2']]));
        t.assertEq(r.summary.rowsMissing, 1, 'id 2 present only in expected (missing)');
        t.assertEq(r.summary.rowsUnexpected, 1, 'id 3 present only in produced (unexpected)');
        t.assertEq(r.summary.bySeverity.error, 1, 'subset: missing row tolerated, unexpected row is still an error');
        t.assertEq(r.valid, false, 'the unexpected row alone makes this invalid');
        t.assertEq(r.aborted, false, 'subset not aborted');
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

    // ---------------- v1.4.0 coverage vectors (P3) ----------------

    // B060 — ToleranceSpec {field,from}: a per-row ε read from a sibling column (§15.8).
    U('compare — tolerance {field,from}: per-row ε from a sibling column', (t) => {
        const cols = { id: { type: { name: 'int' } }, amount: { type: { name: 'float' } }, tol: { type: { name: 'float' } } };
        const schema = {
            meta: META, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' }, structure: { columnMatching: 'byName' },
            columns: cols,
            comparison: {
                match: { keys: ['id'] },
                fields: { amount: { tolerance: { field: 'tol', from: 'expected' } } },
                severity: { toleranceMatch: 'warning' },
            },
        };
        const Tf = (rows) => ({ headers: ['id', 'amount', 'tol'], rows });
        const r = TV().compare(schema, Tf([['1', '1.02', '0.05']]), Tf([['1', '1.00', '0.05']]));
        const cd = r.diff.rows[0].cells.amount;
        t.assertEq(cd.tier, 'toleranceMatch', 'within the per-row ε');
        t.assert(Math.abs(cd.delta - 0.02) < 1e-9, 'delta recorded');
        t.assertEq(cd.tolerance, 0.05, 'ε resolved from the tol column');
        t.assertEq(r.summary.bySeverity.warning, 1, 'toleranceMatch → warning per config');
        const e = r.cellRegister.find((x) => x.ruleName === 'toleranceMatch');
        t.assertEq(e.context.toleranceSource, 'field:tol@expected', '§15.8 field toleranceSource tag');
        // shrink ε below Δ → the same row now mismatches
        const r2 = TV().compare(schema, Tf([['1', '1.02', '0.01']]), Tf([['1', '1.00', '0.01']]));
        t.assertEq(r2.diff.rows[0].cells.amount.tier, 'valueMismatch', 'ε < Δ → valueMismatch');
        t.assertEq(r2.summary.bySeverity.error, 1, 'now an error');
    });

    // B060 — ToleranceSpec {fn}: a custom per-row ε resolver (§15.8).
    U('compare — tolerance {fn}: custom per-row ε resolver', (t) => {
        const schema = baseSchema({
            match: { keys: ['id'] },
            fields: { amount: { tolerance: { fn: 'tolFn' } } },
            severity: { toleranceMatch: 'warning' },
        });
        const r = TV().compare(schema, T([['1', 'x', '1.02']]), T([['1', 'x', '1.00']]), { functions: { tolFn: () => 0.05 } });
        const cd = r.diff.rows[0].cells.amount;
        t.assertEq(cd.tier, 'toleranceMatch', 'within the fn-resolved ε');
        t.assertEq(cd.tolerance, 0.05, 'fn return is the ε');
        const e = r.cellRegister.find((x) => x.ruleName === 'toleranceMatch');
        t.assertEq(e.context.toleranceSource, 'custom:tolFn', '§15.8 custom toleranceSource tag');
        // a tighter fn flips the outcome
        const r2 = TV().compare(schema, T([['1', 'x', '1.02']]), T([['1', 'x', '1.00']]), { functions: { tolFn: () => 0.001 } });
        t.assertEq(r2.diff.rows[0].cells.amount.tier, 'valueMismatch', 'ε < Δ → valueMismatch');
    });

    // B061 — cell-level fuzzy on a non-key string column classifies as the fuzzyMatch tier (§15.4/§15.6).
    U('compare — cell-level fuzzy on a non-key string column → fuzzyMatch tier', (t) => {
        const schema = baseSchema({ match: { keys: ['id'] }, fields: { name: { fuzzy: { metric: 'tokenizedFuzzy', threshold: 0.6 } } } });
        const r = TV().compare(schema, T([['1', 'Acme Corporation', '1']]), T([['1', 'Acme Corp', '1']]));
        const cd = r.diff.rows[0].cells.name;
        t.assertEq(cd.tier, 'fuzzyMatch', 'classifies as fuzzyMatch');
        t.assertEq(cd.rollup, 'equivalent', 'rollup equivalent');
        t.assert(cd.similarity > 0.6, 'similarity recorded above threshold');
        t.assertEq(r.summary.bySeverity.warning, 1, 'documented default fuzzyMatch severity is warning');
        const e = r.cellRegister.find((x) => x.ruleName === 'fuzzyMatch');
        t.assertEq(e.field, 'name', 'register keeps the field');
        t.assertEq(e.severity, 'warning', 'default severity warning');
        t.assert(typeof e.context.similarity === 'number', 'similarity in context');
        // clearly-dissimilar strings drop below threshold → valueMismatch
        const r2 = TV().compare(schema, T([['1', 'Acme Corporation', '1']]), T([['1', 'XXXXXXX', '1']]));
        t.assertEq(r2.diff.rows[0].cells.name.tier, 'valueMismatch', 'below threshold → valueMismatch');
    });

    // B062 — crossTypeMismatch: both interpretable but interpreted classes differ (§15.4).
    U('compare — crossTypeMismatch tier (interpreted classes differ)', (t) => {
        const schema = {
            meta: META, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' }, structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, s: { type: { name: 'skip' } } },
            comparison: { match: { keys: ['id'] } },
        };
        const Ts = (rows) => ({ headers: ['id', 's'], rows });
        // a skip column passes both values through untouched; native number vs native string → classes differ
        const r = TV().compare(schema, Ts([[1, 5]]), Ts([[1, 'hello']]));
        const cd = r.diff.rows[0].cells.s;
        t.assertEq(cd.tier, 'crossTypeMismatch', 'number-class vs string-class');
        t.assertEq(cd.rollup, 'different', 'rollup different');
        t.assertEq(r.summary.bySeverity.error, 1, 'default crossTypeMismatch severity is error');
        const e = r.cellRegister.find((x) => x.ruleName === 'crossTypeMismatch');
        t.assertEq(e.field, 's', 'register field');
        t.assertEq(e.severity, 'error', 'default severity error');
    });

    // B063 — uninterpretable-cell raw-string fallback (§15.4): identical raw → exact, else valueMismatch.
    U('compare — uninterpretable cells: identical raw → exact, else valueMismatch', (t) => {
        const schema = {
            meta: META, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' }, structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, v: { type: { name: 'int' } } },
            comparison: { match: { keys: ['id'] } },
        };
        const Tv = (rows) => ({ headers: ['id', 'v'], rows });
        // both "abc" fail int interpretation; identical raw → compare equal "by design"
        const same = TV().compare(schema, Tv([['1', 'abc']]), Tv([['1', 'abc']]));
        t.assertEq(same.diff.rows[0].cells.v.tier, 'exact', 'two identically malformed cells → exact');
        t.assertEq(same.diff.rows[0].cells.v.rollup, 'equal', 'rollup equal');
        t.assertEq(same.diff.rows[0].cells.v.producedInterpreted, null, 'uninterpretable → no interpreted value');
        t.assertEq(same.valid, true, 'clean');
        // differing raw → valueMismatch
        const diff = TV().compare(schema, Tv([['1', 'abc']]), Tv([['1', 'abd']]));
        t.assertEq(diff.diff.rows[0].cells.v.tier, 'valueMismatch', 'differing raw → valueMismatch');
        t.assertEq(diff.summary.bySeverity.error, 1, 'an error');
    });

    // B064 — null handling in compare() (§15.4): both effectively-null → exact; exactly one → valueMismatch.
    U('compare — null handling: both null → exact; one null → valueMismatch', (t) => {
        const schema = baseSchema({ match: { keys: ['id'] } });
        const both = TV().compare(schema, T([['1', 'x', null]]), T([['1', 'x', null]]));
        t.assertEq(both.diff.rows[0].cells.amount.tier, 'exact', 'both null → exact');
        t.assertEq(both.diff.rows[0].cells.amount.rollup, 'equal', 'rollup equal');
        t.assertEq(both.valid, true, 'clean');
        const one = TV().compare(schema, T([['1', 'x', null]]), T([['1', 'x', '5']]));
        t.assertEq(one.diff.rows[0].cells.amount.tier, 'valueMismatch', 'exactly one null → valueMismatch');
        t.assertEq(one.summary.bySeverity.error, 1, 'an error');
    });

    // B065 — setMode:'subset' orphan severity defaults (§15.6): rowMissing → none, rowUnexpected → error.
    U('compare — setMode subset: rowMissing defaults to none, rowUnexpected to error', (t) => {
        const schema = baseSchema({ match: { keys: ['id'], setMode: 'subset' } });
        const r = TV().compare(schema,
            T([['1', 'a', '1'], ['9', 'z', '9']]),
            T([['1', 'a', '1'], ['2', 'b', '2'], ['3', 'c', '3']]));
        // two expected rows (2,3) are missing but severity none → no error, no register entry
        t.assertEq(r.summary.rowsMissing, 2, 'two missing');
        t.assert(!r.summary.details.some((d) => d.ruleName === 'rowMissing'), 'rowMissing suppressed at severity none');
        t.assertEq(r.cellRegister.filter((e) => e.ruleName === 'rowMissing').length, 0, 'no rowMissing register entry');
        // the extra produced row (9) is rowUnexpected at error
        t.assertEq(r.summary.rowsUnexpected, 1, 'one unexpected');
        const ru = r.cellRegister.find((e) => e.ruleName === 'rowUnexpected');
        t.assertEq(ru.severity, 'error', 'rowUnexpected defaults to error under subset');
        t.assertEq(r.summary.bySeverity.error, 1, 'exactly the one unexpected error');
        t.assertEq(r.valid, false, 'invalid due to the unexpected row');
    });

    // B067 — fuzzy metrics jaroWinkler & levenshtein compute the documented similarity (§15.6).
    U('compare — fuzzy metrics jaroWinkler & levenshtein compute documented similarity', (t) => {
        const mk = (metric) => baseSchema({ match: { keys: ['id'] }, fields: { name: { fuzzy: { metric, threshold: 0.5 } } } });
        const lev = TV().compare(mk('levenshtein'), T([['1', 'abc', '1']]), T([['1', 'abd', '1']]));
        t.assertEq(lev.diff.rows[0].cells.name.tier, 'fuzzyMatch', 'levenshtein pairs above threshold');
        t.assert(Math.abs(lev.diff.rows[0].cells.name.similarity - (2 / 3)) < 1e-9, 'lev sim = 1 − 1/3');
        const jw = TV().compare(mk('jaroWinkler'), T([['1', 'martha', '1']]), T([['1', 'marhta', '1']]));
        t.assertEq(jw.diff.rows[0].cells.name.tier, 'fuzzyMatch', 'jaroWinkler pairs above threshold');
        t.assert(Math.abs(jw.diff.rows[0].cells.name.similarity - 0.9611111111111111) < 1e-9, 'jw sim = classic martha/marhta score');
        // dissimilar strings fall below threshold under levenshtein
        const miss = TV().compare(mk('levenshtein'), T([['1', 'abcdef', '1']]), T([['1', 'zzzzzz', '1']]));
        t.assertEq(miss.diff.rows[0].cells.name.tier, 'valueMismatch', 'lev below threshold → valueMismatch');
    });

    // B068 — per-component fuzzy threshold map (§15.6): pairs only if every component meets its own
    // threshold; recorded similarity = min across components.
    U('compare — per-component fuzzy threshold map: all components must pass, similarity = min', (t) => {
        const cols = { a: { type: { name: 'string' } }, b: { type: { name: 'string' } } };
        const mk = (threshold) => ({
            meta: META, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' }, structure: { columnMatching: 'byName' },
            columns: cols,
            comparison: {
                match: { keys: ['a', 'b'], fuzzy: { components: ['a', 'b'], threshold, metric: 'levenshtein' } },
                severity: { fuzzyKeyMatch: 'warning' },
            },
        });
        const H = (rows) => ({ headers: ['a', 'b'], rows });
        // a: abc~abd (2/3), b: hello~hallo (4/5); both clear a 0.5 map → pair, similarity = min = 2/3
        const r = TV().compare(mk({ a: 0.5, b: 0.5 }), H([['abc', 'hello']]), H([['abd', 'hallo']]));
        t.assertEq(r.diff.rows[0].status, 'fuzzyMatched', 'pairs when every component meets its own threshold');
        t.assert(Math.abs(r.diff.rows[0].similarity - (2 / 3)) < 1e-9, 'recorded similarity is the min across components');
        const fk = r.cellRegister.find((e) => e.ruleName === 'fuzzyKeyMatch');
        t.assert(Math.abs(fk.context.similarity - (2 / 3)) < 1e-9, 'context similarity = min');
        // raise b's own threshold above its 0.8 similarity → the pair no longer forms
        const r2 = TV().compare(mk({ a: 0.5, b: 0.95 }), H([['abc', 'hello']]), H([['abd', 'hallo']]));
        t.assertEq(r2.summary.rowsMatched, 0, 'one failing component blocks the pairing');
        t.assert(r2.diff.rows.some((x) => x.status === 'missing') && r2.diff.rows.some((x) => x.status === 'unexpected'),
            'rows fall through to orphans');
    });

    // B070 — diffChecks.table mismatchRateMax gates on the fraction of different cells (§15.7).
    U('compare — diffChecks mismatchRateMax gates on the fraction of different cells', (t) => {
        const schema = baseSchema({
            match: { keys: ['id'] },
            diffChecks: { table: [{ name: 'mrm', type: 'mismatchRateMax', severity: 'error', params: { max: 0.3 } }] },
        });
        // 2 different of 6 compared cells → rate 1/3 > 0.3 → fires
        const r = TV().compare(schema, T([['1', 'x', '1'], ['2', 'y', '2']]), T([['1', 'DIFF', '1'], ['2', 'y', '99']]));
        t.assertEq(r.diff.summary.differentCells, 2, 'two different cells');
        t.assertEq(r.diff.summary.comparedCells, 6, 'six compared cells');
        t.assert(r.diff.tableCheckFails.some((f) => f.name === 'mrm'), 'recorded in tableCheckFails');
        const e = r.cellRegister.find((x) => x.ruleName === 'mismatchRateMax:mrm');
        t.assertEq(e.severity, 'error', 'fires at the configured severity');
        t.assert(Math.abs(e.context.actualRate - 1 / 3) < 1e-9, 'actualRate = different / compared');
        t.assertEq(e.context.max, 0.3, 'configured max echoed');
        // under the threshold → no fire
        const clean = TV().compare(schema, T([['1', 'x', '1'], ['2', 'y', '2']]), T([['1', 'x', '1'], ['2', 'y', '2']]));
        t.assertEq(clean.diff.tableCheckFails.length, 0, 'no fail below threshold');
        t.assertEq(clean.valid, true, 'clean');
    });

    // B071 — failing custom diff checks produce customDiff:<name>, populate RowDiff.checkFails and
    // diff.tableCheckFails (§15.7).
    U('compare — failing custom diff checks: customDiff:<name>, checkFails, tableCheckFails', (t) => {
        const schema = baseSchema({
            match: { keys: ['id'] },
            diffChecks: {
                row: [{ name: 'rowchk', type: 'custom', fn: 'rc', severity: 'error' }],
                table: [{ name: 'tblchk', type: 'custom', fn: 'tc', severity: 'warning' }],
            },
        });
        const functions = {
            rc: (rd) => (rd.status === 'matched' ? [{ pass: false, field: 'amount', message: 'row bad' }] : []),
            tc: () => [{ pass: false, row: 0, field: 'name', message: 'table bad' }],
        };
        const r = TV().compare(schema, T([['1', 'x', '1']]), T([['1', 'x', '1']]), { functions });
        t.assertEq(r.diff.rows[0].checkFails, [{ name: 'rowchk', field: 'amount', message: 'row bad' }], 'RowDiff.checkFails populated');
        t.assertEq(r.diff.tableCheckFails, [{ name: 'tblchk', matchKey: 0, field: 'name', message: 'table bad' }], 'diff.tableCheckFails populated');
        const row = r.cellRegister.find((e) => e.ruleName === 'customDiff:rowchk');
        t.assertEq(row.severity, 'error', 'row check at its severity');
        t.assertEq(row.context.level, 'row', 'row level tag');
        t.assertEq(row.context.userMessage, 'row bad', 'user message threaded');
        const tbl = r.cellRegister.find((e) => e.ruleName === 'customDiff:tblchk');
        t.assertEq(tbl.severity, 'warning', 'table check at its severity');
        t.assertEq(tbl.context.level, 'table', 'table level tag');
        t.assertEq(r.summary.bySeverity.error, 1, 'one error');
        t.assertEq(r.summary.bySeverity.warning, 1, 'one warning');
    });

    // B072 — compare()'s custom-function contract aborts: customFunctionError (throw) and
    // customFunctionContractViolation (negative ε / duplicate diff-check keys) on tolerance-fn and
    // diffChecks-fn paths (§15.7/§15.8).
    U('compare — custom-function aborts: error (throw) and contractViolation (bad return)', (t) => {
        const tolSchema = baseSchema({ match: { keys: ['id'] }, fields: { amount: { tolerance: { fn: 'f' } } } });
        // (1) tolerance fn throws → customFunctionError abort
        const thrown = TV().compare(tolSchema, T([['1', 'x', '1.02']]), T([['1', 'x', '1.00']]),
            { functions: { f: () => { throw new Error('boom'); } } });
        t.assertEq(thrown.aborted, true, 'tolerance throw aborts');
        t.assertEq(thrown.abortReason, 'customFunctionError', 'abortReason customFunctionError');
        t.assert(thrown.cellRegister.some((e) => e.ruleName === 'customFunctionError:tolerance:amount'), 'prefixed register rule');
        // (2) tolerance fn returns a negative ε → contract violation abort
        const neg = TV().compare(tolSchema, T([['1', 'x', '1.02']]), T([['1', 'x', '1.00']]), { functions: { f: () => -1 } });
        t.assertEq(neg.abortReason, 'customFunctionContractViolation', 'negative ε → contract abort');
        t.assert(neg.cellRegister.some((e) => e.ruleName === 'customFunctionContractViolation:tolerance:amount'), 'prefixed rule');
        // (3) diffChecks row fn throws → customFunctionError abort
        const dcSchema = baseSchema({ match: { keys: ['id'] }, diffChecks: { row: [{ name: 'rc', type: 'custom', fn: 'g', severity: 'error' }] } });
        const dThrow = TV().compare(dcSchema, T([['1', 'x', '1']]), T([['1', 'x', '1']]),
            { functions: { g: () => { throw new Error('rowboom'); } } });
        t.assertEq(dThrow.abortReason, 'customFunctionError', 'diff-check throw aborts');
        t.assert(dThrow.cellRegister.some((e) => e.ruleName === 'customFunctionError:rc'), 'prefixed rule');
        // (4) diffChecks row fn emits duplicate keys → contract violation abort
        const dDup = TV().compare(dcSchema, T([['1', 'x', '1']]), T([['1', 'x', '1']]),
            { functions: { g: () => [{ pass: false, field: 'amount', message: 'a' }, { pass: false, field: 'amount', message: 'b' }] } });
        t.assertEq(dDup.abortReason, 'customFunctionContractViolation', 'duplicate diff-check keys → contract abort');
        t.assert(dDup.cellRegister.some((e) => e.ruleName === 'customFunctionContractViolation:rc'), 'prefixed rule');
    });

    // B073 — ComparisonResult.validWithWarnings.
    U('compare — validWithWarnings on a compare() result', (t) => {
        const warned = TV().compare(baseSchema({ match: { keys: ['id'] }, severity: { interpretedMatch: 'warning' } }),
            T([['1', 'x', '1.0']]), T([['1', 'x', '1']]));
        t.assertEq(warned.valid, true, 'valid');
        t.assertEq(warned.validWithWarnings, true, 'valid with a warning present');
        const clean = TV().compare(baseSchema({ match: { keys: ['id'] } }), T([['1', 'x', '1']]), T([['1', 'x', '1']]));
        t.assertEq(clean.validWithWarnings, false, 'no warnings → false');
        const errored = TV().compare(baseSchema({ match: { keys: ['id'] } }), T([['1', 'x', '1']]), T([['1', 'x', '2']]));
        t.assertEq(errored.validWithWarnings, false, 'invalid → false');
    });

    // B074 — resultConfig termination (maxErrors truncation, stopPolicy abort) applies to compare() (§15.10).
    U('compare — resultConfig termination applies to compare() phases', (t) => {
        const mk = (resultConfig) => ({
            meta: META, resultConfig,
            evaluation: { strictType: false, timezone: 'utc' }, structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, name: { type: { name: 'string' } }, amount: { type: { name: 'float' } } },
            comparison: { match: { keys: ['id'] } },
        });
        const prod = T([['1', 'a', '1'], ['2', 'b', '2'], ['3', 'c', '3'], ['4', 'd', '4']]);
        const exp = T([['1', 'A', '1'], ['2', 'B', '2'], ['3', 'C', '3'], ['4', 'D', '4']]);
        // maxErrors caps and marks truncated (not aborted)
        const capped = TV().compare(mk({ collectCellRegister: true, maxErrors: 2 }), prod, exp);
        t.assertEq(capped.truncated, true, 'truncated');
        t.assertEq(capped.truncationReason, 'maxErrors', 'truncationReason maxErrors');
        t.assertEq(capped.summary.bySeverity.error, 2, 'capped at maxErrors');
        t.assertEq(capped.aborted, false, 'truncated ≠ aborted');
        // stopPolicy firstError aborts on the first error
        const stopped = TV().compare(mk({ collectCellRegister: true, stopPolicy: 'firstError' }), prod, exp);
        t.assertEq(stopped.aborted, true, 'aborted');
        t.assertEq(stopped.abortReason, 'stopPolicy', 'abortReason stopPolicy');
        t.assertEq(stopped.summary.bySeverity.error, 1, 'stopped after the first error');
    });

    // B075/B076/B077 — summary.byPhase / byColumn / details grouping for a compare() run (§15.10).
    U('compare — summary.byPhase / byColumn / details grouping for a compare() run', (t) => {
        const schema = baseSchema({ match: { keys: ['id'] }, severity: { interpretedMatch: 'warning' } });
        const r = TV().compare(schema,
            T([['1', 'x', '1.0'], ['2', 'y', '1.0'], ['3', 'zz', '5']]),
            T([['1', 'x', '1'], ['2', 'y', '1'], ['3', 'DIFF', '5']]));
        // byPhase: the two interpretedMatch warnings + one valueMismatch all land in cellComparison
        t.assertEq(r.summary.byPhase.cellComparison, 3, 'cellComparison counter');
        t.assertEq(r.summary.byPhase.structuralComparison, 0, 'no structural entries');
        // byColumn
        t.assertEq(r.summary.byColumn.amount, { error: 0, warning: 2 }, 'amount warnings');
        t.assertEq(r.summary.byColumn.name, { error: 1, warning: 0 }, 'name error');
        // details grouping fields
        const im = r.summary.details.find((d) => d.ruleName === 'interpretedMatch');
        t.assertEq(im.count, 2, 'grouped count');
        t.assertEq(im.firstOccurrenceRow, 0, 'firstOccurrenceRow');
        t.assertEq(im.topSampleRows, [0, 1], 'topSampleRows');
        const vm = r.summary.details.find((d) => d.ruleName === 'valueMismatch');
        t.assertEq(vm.firstOccurrenceRow, 2, 'valueMismatch first row');
        t.assertEq(vm.topSampleValues, [{ value: 'zz', frequency: 1 }], 'topSampleValues from the produced cell');
        t.assertEq(vm.fieldName, 'name', 'grouped by field');
    });

    // B078/B079 — diff.summary counts and CellDiff.produced/expectedInterpreted (§15.9).
    U('compare — diff.summary counts and CellDiff.produced/expectedInterpreted', (t) => {
        const schema = baseSchema({ match: { keys: ['id'], setMode: 'subset' } });
        const r = TV().compare(schema, T([['1', 'x', '1.0'], ['2', 'y', '9']]), T([['1', 'x', '1'], ['3', 'z', '3']]));
        t.assertEq(r.diff.summary.comparedCells, 3, 'comparedCells (the one matched row × 3 cols)');
        t.assertEq(r.diff.summary.differentCells, 0, 'differentCells');
        t.assertEq(r.diff.summary.equivalentCells, 1, 'equivalentCells (amount interpretedMatch)');
        t.assert(Math.abs(r.diff.summary.orphanRateExpected - 0.5) < 1e-9, 'orphanRateExpected = 1 missing / 2 expected');
        t.assert(Math.abs(r.diff.summary.orphanRateProduced - 0.5) < 1e-9, 'orphanRateProduced = 1 unexpected / 2 produced');
        const rd = r.diff.rows.find((x) => x.status === 'matched');
        t.assertEq(rd.cells.amount.producedInterpreted, 1, 'produced "1.0" interpreted to 1');
        t.assertEq(rd.cells.amount.expectedInterpreted, 1, 'expected "1" interpreted to 1');
        t.assertEq(rd.cells.name.producedInterpreted, 'x', 'string interpreted value carried (produced)');
        t.assertEq(rd.cells.name.expectedInterpreted, 'x', 'string interpreted value carried (expected)');
    });

    // B080 — resultConfig.collectCellObservations / ValidationResult.cellObservations: full field set
    // and all six outcome enum values (§9.5). (validate() channel, exercised here alongside compare().)
    U('validate — collectCellObservations: full field set and all six outcomes', (t) => {
        const schema = {
            meta: META, resultConfig: { collectCellRegister: true, collectCellObservations: true },
            evaluation: { strictType: false, timezone: 'utc' },
            structure: { columnMatching: 'byName', allowMissingColumns: true },
            columns: {
                n_int: { type: { name: 'int' }, nullable: true },
                s_str: { type: { name: 'string' } },
                f_amt: { type: { name: 'float' } },
                c_skip: { type: { name: 'skip' } },
                missing: { type: { name: 'string' }, nullable: true },
            },
        };
        const table = {
            headers: ['n_int', 's_str', 'f_amt', 'c_skip'],
            rows: [
                [5, 'hello', '1.5', 'anything'],   // native int, native str, interpreted float, skipped
                [null, 'x', '2.5', 'y'],           // effectivelyNull int
                ['abc', 'z', '3.5', 'w'],          // violation (typeMismatch int)
            ],
        };
        // default off → null channel
        t.assertEq(TV().validate({ ...schema, resultConfig: { collectCellRegister: true } }, table).cellObservations,
            null, 'off by default → null');
        const obs = TV().validate(schema, table).cellObservations;
        const byOutcome = {};
        for (const o of obs) (byOutcome[o.outcome] = byOutcome[o.outcome] || []).push(o);
        t.assertEq(Object.keys(byOutcome).sort(),
            ['effectivelyNull', 'interpreted', 'native', 'notChecked', 'skipped', 'violation'], 'all six outcomes present');
        // native int (row 0): full field set
        t.assertEq(byOutcome.native.find((o) => o.field === 'n_int' && o.row === 0),
            { row: 0, field: 'n_int', rawValue: 5, interpretedValue: 5, outcome: 'native', worstSeverity: null },
            'native observation full field set');
        // interpreted float
        t.assertEq(byOutcome.interpreted.find((o) => o.field === 'f_amt' && o.row === 0).interpretedValue, 1.5, 'interpreted value coerced');
        // effectivelyNull
        t.assertEq(byOutcome.effectivelyNull[0].field, 'n_int', 'null cell → effectivelyNull');
        // violation carries worstSeverity
        t.assertEq(byOutcome.violation.find((o) => o.field === 'n_int' && o.row === 2).worstSeverity, 'error', 'violation worstSeverity');
        // skipped + notChecked
        t.assertEq(byOutcome.skipped[0].field, 'c_skip', 'skip column → skipped');
        t.assertEq(byOutcome.notChecked[0].field, 'missing', 'unmatched column → notChecked');
    });

    // B081 — exportAnnotatedXlsx (§3.8/F6): required-field rejection + per-outcome cell tint.
    U('exportAnnotatedXlsx: rejection path + per-outcome cell tint', async (t) => {
        const schema = {
            meta: META, resultConfig: { collectCellRegister: true, collectCellObservations: true },
            evaluation: { strictType: false, timezone: 'utc' },
            structure: { columnMatching: 'byName', allowMissingColumns: true },
            columns: {
                n_int: { type: { name: 'int' }, nullable: true },
                s_str: { type: { name: 'string' } },
                f_amt: { type: { name: 'float' } },
            },
        };
        const table = { headers: ['n_int', 's_str', 'f_amt'], rows: [[5, 'hello', '1.5'], ['abc', 'z', '3.5']] };
        // rejection: a result without cellObservations
        let rejected = false;
        try { await TV().exportAnnotatedXlsx({ result: { valid: true }, table, schema }); }
        catch (e) { rejected = e.name === 'TableValidationConfigError'; }
        t.assert(rejected, 'refuses without cellObservations');
        const r = TV().validate(schema, table);
        const blob = await TV().exportAnnotatedXlsx({ result: r, table, schema });
        t.assertEq(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'MIME type');
        const wb = new window.ExcelJS.Workbook();
        await wb.xlsx.load(await blob.arrayBuffer());
        const ws = wb.getWorksheet('Annotated');
        t.assert(!!ws, 'Annotated sheet present');
        t.assertEq(ws.getRow(1).values.slice(1), ['n_int', 's_str', 'f_amt'], 'header = display names');
        const fill = (rowNum, colNum) => {
            const c = ws.getRow(rowNum).getCell(colNum);
            return c.fill && c.fill.fgColor ? c.fill.fgColor.argb : null;
        };
        // row 2 (r=1) n_int "abc" is a violation → error tint; row 1 (r=0) f_amt interpreted → blue tint; native untinted
        t.assertEq(fill(3, 1), 'FFFFC7CE', 'violation cell tinted error');
        t.assertEq(fill(2, 3), 'FFDDEBF7', 'interpreted cell tinted interpreted-blue');
        t.assertEq(fill(2, 1), null, 'native cell untinted');
    }, { needsExcelJS: true });

    // B082 — exportComparisonXlsx (§15.11): the 'Comparison' sheet's columns, cell text, and highlight severity.
    U('exportComparisonXlsx: Comparison sheet columns, cell text, and highlight severity', async (t) => {
        const schema = baseSchema({ match: { keys: ['id'] } });     // default setMode 'exact'
        const produced = T([['1', 'aa', '1.0'], ['9', 'zz', '9']]);
        const expected = T([['1', 'bb', '1'], ['2', 'cc', '2']]);
        const r = TV().compare(schema, produced, expected);
        const blob = await TV().exportComparisonXlsx({ result: r, table: produced, schema, expected });
        const wb = new window.ExcelJS.Workbook();
        await wb.xlsx.load(await blob.arrayBuffer());
        const cmp = wb.getWorksheet('Comparison');
        t.assert(!!cmp, 'Comparison sheet exists');
        t.assertEq(cmp.getRow(1).values.slice(1), ['Match Status', 'Scope', 'id', 'name', 'amount'], 'header columns');
        // matched row (id 1): first data row, name mismatch + amount interpreted-equivalence
        const matched = cmp.getRow(2);
        t.assertEq(matched.getCell(1).value, 'matched', 'Match Status column');
        t.assertEq(matched.getCell(2).value, 'in', 'Scope column');
        t.assertEq(matched.getCell(4).value, '✖ aa ≠ bb', 'valueMismatch rendered as ✖ … ≠ …');
        t.assertEq(matched.getCell(5).value, '⚠ 1.0 ≈ 1', 'interpretedMatch rendered as ⚠ … ≈ …');
        const argb = (cell) => (cell.fill && cell.fill.fgColor ? cell.fill.fgColor.argb : null);
        t.assertEq(argb(matched.getCell(4)), 'FFFFC7CE', 'valueMismatch cell highlighted error');
        t.assertEq(argb(matched.getCell(5)), 'FFFFEB9C', 'interpretedMatch cell highlighted warning');
        // orphan rows: the Match Status cell is highlighted at the orphan severity (exact → both error)
        let missingRow = null, unexpectedRow = null;
        cmp.eachRow((row, rn) => {
            if (rn === 1) return;
            if (row.getCell(1).value === 'missing') missingRow = row;
            if (row.getCell(1).value === 'unexpected') unexpectedRow = row;
        });
        t.assert(!!missingRow && !!unexpectedRow, 'both orphan rows present on the Comparison sheet');
        t.assertEq(argb(missingRow.getCell(1)), 'FFFFC7CE', 'rowMissing status highlighted error');
        t.assertEq(argb(unexpectedRow.getCell(1)), 'FFFFC7CE', 'rowUnexpected status highlighted error');
    }, { needsExcelJS: true });

    // ---------------- v1.4.0 coverage vectors (P6) ----------------

    // B100 — Core §13.3's documented cross-engine consequence: two datetimes differing only beyond
    // the third fractional digit carry the same instant and compare equal (interpretedMatch) in §15;
    // a genuine difference AT the third digit is a real valueMismatch.
    U('compare — SSSSSS datetimes differing only beyond the 3rd fractional digit compare equal (§13.3/§15)', (t) => {
        const schema = {
            meta: { schemaVersion: '1.3.0', name: 'cmp' }, resultConfig: { collectCellRegister: true },
            evaluation: { strictType: false, timezone: 'utc' }, structure: { columnMatching: 'byName' },
            columns: { id: { type: { name: 'int' } }, ts: { type: { name: 'datetime', formats: ['yyyy-MM-dd HH:mm:ss.SSSSSS'] } } },
            comparison: { match: { keys: ['id'] }, severity: { interpretedMatch: 'warning' } },
        };
        const T = (rows) => ({ headers: ['id', 'ts'], rows });
        // differ only in the 4th-6th fractional digits (truncated away at ms resolution) → same instant
        const beyond = TV().compare(schema,
            T([['1', '2026-07-15 14:30:45.123456']]), T([['1', '2026-07-15 14:30:45.123999']]));
        t.assertEq(beyond.diff.rows[0].cells.ts.tier, 'interpretedMatch', 'beyond-3rd-digit difference → interpretedMatch');
        t.assertEq(beyond.diff.rows[0].cells.ts.rollup, 'equivalent', 'rollup equivalent (same instant)');
        t.assertEq(beyond.summary.bySeverity.warning, 1, 'interpretedMatch severity per config');
        t.assertEq(beyond.valid, true, 'valid (only a warning)');
        // differ AT the 3rd fractional digit (millisecond) → genuinely different instants
        const at3rd = TV().compare(schema,
            T([['1', '2026-07-15 14:30:45.123456']]), T([['1', '2026-07-15 14:30:45.124000']]));
        t.assertEq(at3rd.diff.rows[0].cells.ts.tier, 'valueMismatch', 'difference at the 3rd digit → valueMismatch');
        t.assertEq(at3rd.summary.bySeverity.error, 1, 'a real error');
    }, { needsLuxon: true });

    // B101 — exact-tier "native kind": the exact tier requires BOTH identical raw String() form AND
    // identical native JS typeof (dist cellOutcome: `String(pCell)===String(eCell) && typeof pCell===typeof eCell`).
    // A native number and a string carrying the same digits share the raw form but differ in kind, so
    // they fall through to interpretedMatch instead — distinct from the raw-string-identity path already
    // covered by the "both null"/"uninterpretable" exact-tier vectors above.
    U('compare — exact tier requires same native kind, not just equal interpreted value', (t) => {
        const schema = baseSchema({ match: { keys: ['id'] } });
        const T2 = (rows) => ({ headers: ['id', 'name', 'amount'], rows });
        // both sides native numbers, identical → same String() and same typeof → exact
        const bothNative = TV().compare(schema, T2([[1, 'x', 5]]), T2([[1, 'x', 5]]));
        t.assertEq(bothNative.diff.rows[0].cells.amount.tier, 'exact', 'native number vs native number → exact');
        // produced native number, expected string of the same digits: same String() form ("5"==="5")
        // but typeof differs (number vs string) → NOT exact, falls to interpretedMatch
        const mixedKind = TV().compare(schema, T2([[1, 'x', 5]]), T2([[1, 'x', '5']]));
        t.assertEq(mixedKind.diff.rows[0].cells.amount.tier, 'interpretedMatch', 'native vs string of equal value → interpretedMatch, not exact');
        t.assertEq(mixedKind.diff.rows[0].cells.amount.rollup, 'equivalent', 'rollup equivalent');
        // both sides raw strings, identical → same typeof (string) → exact
        const bothString = TV().compare(schema, T2([['1', 'x', '5']]), T2([['1', 'x', '5']]));
        t.assertEq(bothString.diff.rows[0].cells.amount.tier, 'exact', 'string vs string, identical raw → exact');
    });
})();
