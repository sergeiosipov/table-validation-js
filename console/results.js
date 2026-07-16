/* Authoring & Run Console — Run panel, result views, export bar
 * (UI arch §4.3 collection-flag rule, §6 result presentation — engine outputs verbatim). */
'use strict';
(function (global) {
    const NS = global.TVConsole = global.TVConsole || {};
    const TV = () => global.TableValidation;
    const h = (...a) => NS.h(...a);

    const ROW_CAP = 500;   // simple windowing: filters first, then cap with an honest note (§8)
    const canon = (v) => v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

    // ---------------- Run panel ----------------

    NS.RunPanel = function (store) {
        const st = store.state;
        const r = store.readiness();
        const out = st.run.requestedOutputs;
        const cmpOn = st.authoring.comparisonEnabled;

        const flagLine = (mode) => {
            const f = store.deriveFlags(mode);
            const autos = [];
            if (f.collectCellRegister.value && !f.collectCellRegister.authored) autos.push(`collectCellRegister (${f.collectCellRegister.neededBy.join(', ')})`);
            if (f.collectCellObservations.value && !f.collectCellObservations.authored) autos.push(`collectCellObservations (${f.collectCellObservations.neededBy.join(', ')})`);
            return autos.length ? `auto-enabled for this run: ${autos.join(' · ')}` : 'no collection flags need auto-enabling';
        };

        const outBox = (key, label, extra) => h('label', { class: 'inline' },
            h('input', { type: 'checkbox', checked: out[key], onchange: (e) => store.dispatch.setOutput(key, e.target.checked) }),
            label, extra ? h('small', {}, ' ' + extra) : null);

        const runBtn = (mode, label) => {
            const can = mode === 'validate' ? r.canValidate : r.canCompare;
            const reasons = r.reasons[mode];
            return h('span', { class: 'runbtn' },
                h('button', { class: 'primary big', disabled: !can, title: can ? '' : reasons.join('; '), onclick: () => store.dispatch.run(mode) }, label),
                !can ? h('div', { class: 'hint' }, reasons.map((x) => h('div', {}, '· ' + x))) : null);
        };

        return h('div', { class: 'card' },
            h('div', { class: 'card-title' }, 'Run'),
            h('div', { class: 'fields' },
                h('div', { class: 'field' }, h('label', {}, 'Outputs'),
                    h('span', {},
                        outBox('errorsView', 'Errors view'),
                        outBox('xlsxReport', 'XLSX report'),
                        outBox('annotatedXlsx', 'Annotated XLSX', '(validate only)'))),
                h('div', { class: 'hint' },
                    // §4.3: flags derived from requested outputs; authored artifact untouched
                    `validate: ${flagLine('validate')}${cmpOn ? ` · compare: ${flagLine('compare')}` : ''}`),
                h('div', { class: 'field' },
                    h('label', { title: 'Pins "now" for T+/-N resolution — determinism/repro affordance (§8)' }, 'referenceInstant (optional ISO)'),
                    h('input', { type: 'text', class: 'json', value: st.run.referenceInstant, placeholder: 'e.g. 2026-07-11T00:00:00Z (empty = now)', onchange: (e) => store.dispatch.setReferenceInstant(e.target.value) })),
                h('div', { class: 'field' },
                    h('label', { title: 'JS profile §3.5 localization/custom-wording seam: a JSON map { ruleName: "template with {placeholders}" }. Applied to the run AND threaded to every exporter. String templates only — function templates are API-only.' },
                        'messageTemplates (optional JSON map)'),
                    h('input', { type: 'text', class: 'json', value: st.run.messageTemplates, placeholder: '{"typeMismatch": "expected {expectedType}, got {actualType} — check the feed"}', onchange: (e) => store.dispatch.setMessageTemplates(e.target.value) }))),
            h('div', { class: 'runrow' },
                runBtn('validate', '▶ Validate'),
                cmpOn ? runBtn('compare', '▶ Compare') : h('span', { class: 'hint' }, 'Compare: comparison is off (③)')),
            st.run.status === 'running' ? h('div', {}, 'Running…') : null,
            st.run.error ? h('div', { class: 'notice error' }, `${st.run.error.name}: ${st.run.error.message} (this is a caller/console error — engine aborts land in the result, not here)`) : null,
            st.run.stale && st.run.result ? h('div', { class: 'notice warn' },
                'Config or data changed since this result was produced — it is stale but still viewable. ',
                h('button', { onclick: () => store.dispatch.run(st.run.mode) }, `Re-run ${st.run.mode}`)) : null,
            outputMismatchHint(store));
    };

    // §4.3: selecting an output AFTER a run that lacked its flag doesn't error —
    // it surfaces "[Re-run] needed" for exactly that output.
    function outputMismatchHint(store) {
        const st = store.state;
        const res = st.run.result;
        if (!res || st.run.status !== 'done') return null;
        const out = st.run.requestedOutputs;
        const missing = [];
        if ((out.errorsView || out.xlsxReport) && !res.cellRegister) missing.push('the register (Errors view / XLSX report)');
        if (out.annotatedXlsx && st.run.mode === 'validate' && !res.cellObservations) missing.push('observations (Annotated XLSX)');
        if (!missing.length) return null;
        return h('div', { class: 'notice warn' },
            `This result was produced before ${missing.join(' and ')} ${missing.length > 1 ? 'were' : 'was'} requested. `,
            h('button', { onclick: () => store.dispatch.run(st.run.mode) }, `Re-run ${st.run.mode}`),
            ' to produce it.');
    };

    // ---------------- result views (§6 — verbatim reuse) ----------------

    function reportView(store) {
        const rep = store.state.run.report;
        const res = store.state.run.result;
        // Core §9.3 one-liners, verbatim
        const line = rep.verdict === 'pass' ? `✔ Valid — ${rep.rowsChecked} rows × ${rep.columnsChecked} columns, no issues.`
            : rep.verdict === 'passWithWarnings' ? `⚠ Valid with ${rep.bySeverity.warning} warning(s) across ${rep.checksFailed} check(s) — review optional.`
            : rep.verdict === 'fail' ? `✖ Invalid — ${rep.bySeverity.error} error(s), ${rep.bySeverity.warning} warning(s) in ${rep.columnsAffected} column(s). See report.`
            : `⛔ ${store.state.run.mode === 'compare' ? 'Comparison' : 'Validation'} aborted (${rep.abortReason}): ${rep.topIssues[0] ? rep.topIssues[0].message : ''}`;
        const suffix = rep.truncated ? ' (truncated at limit)' : '';
        const cmp = res.engine === 'compare' ? res.summary : null;
        return h('div', {},
            h('div', { class: 'verdict verdict-' + rep.verdict }, line + suffix),
            h('div', { class: 'kpis' },
                kpi('errors', rep.bySeverity.error), kpi('warnings', rep.bySeverity.warning),
                kpi('checks failed', rep.checksFailed), kpi('columns affected', rep.columnsAffected),
                cmp ? [kpi('matched', cmp.rowsMatched), kpi('missing', cmp.rowsMissing), kpi('unexpected', cmp.rowsUnexpected)] : null),
            rep.topIssues.length ? h('div', {},
                h('h4', {}, 'Top issues'),
                h('table', { class: 'grid' },
                    h('tr', {}, ['severity', 'check', 'column', 'count', 'message'].map((c) => h('th', {}, c))),
                    rep.topIssues.map((t) => h('tr', {},
                        h('td', { class: 'sev-' + t.severity }, t.severity), h('td', {}, t.ruleName),
                        h('td', {}, t.fieldName === null ? '—' : t.fieldName), h('td', {}, t.count), h('td', {}, t.message))))) : null);
    }
    const kpi = (label, value) => h('span', { class: 'kpi' }, h('b', {}, String(value)), ' ', label);

    const SEV_RANK = { error: 0, warning: 1 };

    // §6 "Sortable" — clickable headers cycling asc → desc → default; `keys` maps a
    // header label to a value extractor (null = not sortable).
    function sortableHeader(store, view, cols) {
        const s = store.state.ui.sort;
        return h('tr', {}, cols.map(([label, key]) => h('th', {
            class: key ? 'clickable' : '',
            title: key ? 'click to sort' : '',
            onclick: key ? () => store.dispatch.toggleSort(view, key) : null,
        }, label, s && s.view === view && s.key === key ? (s.dir === 1 ? ' ▲' : ' ▼') : '')));
    }
    function userSort(store, view, rows, extractors, defaultCmp) {
        const s = store.state.ui.sort;
        const out = rows.slice();
        if (s && s.view === view && extractors[s.key]) {
            const ex = extractors[s.key];
            out.sort((a, b) => {
                const va = ex(a), vb = ex(b);
                const c = va === vb ? 0 : va === null || va === undefined ? -1 : vb === null || vb === undefined ? 1
                    : va < vb ? -1 : 1;
                return c * s.dir;
            });
        } else {
            out.sort(defaultCmp);
        }
        return out;
    }

    function summaryView(store) {
        const s = store.state.run.result.summary;
        const EX = {
            severity: (d) => SEV_RANK[d.severity], phase: (d) => d.phase, check: (d) => d.ruleName,
            column: (d) => d.fieldName, count: (d) => d.count, firstRow: (d) => d.firstOccurrenceRow,
        };
        // §6 default sort: severity rank → count desc (mirrors the XLSX Summary sheet)
        const details = userSort(store, 'summary', s.details, EX, (a, b) =>
            SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count || (a.ruleName < b.ruleName ? -1 : 1));
        return h('table', { class: 'grid' },
            sortableHeader(store, 'summary', [['severity', 'severity'], ['phase', 'phase'], ['check', 'check'],
                ['column', 'column'], ['message', null], ['count', 'count'], ['first row', 'firstRow'], ['top samples', null]]),
            details.map((d) => h('tr', {},
                h('td', { class: 'sev-' + d.severity }, d.severity), h('td', {}, d.phase), h('td', {}, d.ruleName),
                h('td', {}, d.fieldName === null ? '—' : d.fieldName),
                h('td', {}, d.message),
                h('td', {}, d.count),
                h('td', {}, d.firstOccurrenceRow === null ? '—' : d.firstOccurrenceRow + 1),   // 1-based display, JSON stays 0-based
                h('td', {}, (d.topSampleValues || []).map((v) => `${v.value} (×${v.frequency})`).join('; ')))));
    }

    function filterBar(store, entries, isCompare, only) {
        const f = store.state.ui.filters;
        const distinct = (fn) => Array.from(new Set(entries.map(fn).filter((v) => v !== null && v !== undefined && v !== ''))).sort();
        const sel = (key, label, options) => (!only || only.includes(key)) ? h('label', { class: 'inline' }, label + ' ',
            h('select', { onchange: (e) => store.dispatch.setFilter(key, e.target.value) },
                h('option', { value: '', selected: !f[key] }, '(all)'),
                options.map((o) => h('option', { value: o, selected: f[key] === o }, o)))) : null;
        return h('div', { class: 'filterbar' },
            sel('severity', 'severity', ['error', 'warning']),
            sel('ruleName', 'check', distinct((e) => e.ruleName)),
            sel('column', 'column', distinct((e) => e.field)),
            isCompare ? sel('scope', 'scope', ['in', 'out']) : null,                                 // §15.11 filter dimensions
            isCompare ? sel('matchStatus', 'match status', ['matched', 'fuzzyMatched', 'missing', 'unexpected', 'excludedDuplicateKey']) : null);
    }

    function applyFilters(store, entries) {
        const f = store.state.ui.filters;
        return entries.filter((e) =>
            (!f.severity || e.severity === f.severity) &&
            (!f.ruleName || e.ruleName === f.ruleName) &&
            (!f.column || e.field === f.column) &&
            (!f.scope || (e.context && (e.context.inScope === true ? 'in' : e.context.inScope === false ? 'out' : '')) === f.scope) &&
            (!f.matchStatus || (e.context && e.context.matchStatus) === f.matchStatus));
    }

    function capNote(shown, total) {
        return shown < total ? h('div', { class: 'hint' }, `showing the first ${shown} of ${total} rows — refine the filters, or use the exports for the full set`) : null;
    }

    function errorsView(store) {
        const res = store.state.run.result;
        const reg = res.cellRegister;
        if (!Array.isArray(reg)) return h('div', { class: 'hint' }, 'No register collected in this run (enable the "Errors view" output and re-run).');
        const isCompare = res.engine === 'compare';
        const EX = {
            severity: (e) => SEV_RANK[e.severity], check: (e) => e.ruleName, column: (e) => e.field,
            row: (e) => e.row, value: (e) => canon(e.value),
        };
        // §6/§15.11 default sort: severity-first, then row ascending
        const filtered = userSort(store, 'errors', applyFilters(store, reg), EX, (a, b) =>
            SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
            ((a.row === null ? -1 : a.row) - (b.row === null ? -1 : b.row)));
        const shown = filtered.slice(0, ROW_CAP);
        return h('div', {},
            filterBar(store, reg, isCompare),
            h('div', { class: 'hint' }, 'Click a row to jump to its cell in the Data view; click a header to sort.'),
            h('table', { class: 'grid' },
                sortableHeader(store, 'errors', [['#', null], ['severity', 'severity'], ['check', 'check'],
                    ['column', 'column'], ['row', 'row'], ['value', 'value'], ['message', null],
                    ...(isCompare ? [['scope', null], ['match status', null]] : [])]),
                shown.map((e, i) => h('tr', {
                    class: e.row !== null ? 'clickable' : '',
                    onclick: e.row !== null ? () => store.dispatch.flashCell(e.row, e.field) : null,   // §6 cross-navigation
                },
                    h('td', {}, i + 1),
                    h('td', { class: 'sev-' + e.severity }, e.severity),
                    h('td', {}, e.ruleName),
                    h('td', {}, e.field === null ? '—' : e.field),
                    h('td', {}, e.row === null ? '—' : e.row + 1),
                    h('td', {}, canon(e.value)),
                    h('td', {}, e.message),
                    isCompare ? h('td', {}, e.context && e.context.inScope === false ? 'out' : e.context && e.context.inScope === true ? 'in' : '—') : null,
                    isCompare ? h('td', {}, (e.context && e.context.matchStatus) || '—') : null))),
            capNote(shown.length, filtered.length));
    }

    // Comparison diff grid (§6 / Core §15.11 — text = rollup, ALWAYS; tint = final severity)
    function diffView(store) {
        const st = store.state;
        const res = st.run.result;
        if (!res.diff) return h('div', { class: 'hint' }, 'The diff grid exists for compare() results only.');
        const runCfg = st.run.runConfig;
        const sev = severityMapOf(runCfg);
        const cols = Object.keys(runCfg.columns || {});
        const present = new Set();
        for (const rd of res.diff.rows) for (const k of Object.keys(rd.cells)) present.add(k);
        const shownCols = cols.filter((c) => present.has(c));

        const f = st.ui.filters;
        const rows = res.diff.rows.filter((rd) =>
            (!f.scope || (rd.inScope ? 'in' : 'out') === f.scope) &&
            (!f.matchStatus || (rd.status === 'matched' ? 'matched' : rd.status === 'fuzzyMatched' ? 'fuzzyMatched' : rd.status) === f.matchStatus));
        const shown = rows.slice(0, ROW_CAP);

        const cellText = (cd) => {
            if (!cd) return '';
            if (cd.rollup === 'equal') return canon(cd.produced);
            const typeTag = cd.tier === 'crossTypeMismatch' ? ' [t]' : '';
            return `${cd.rollup === 'equivalent' ? '⚠' : '✖'} ${canon(cd.produced)} ${cd.rollup === 'equivalent' ? '≈' : '≠'} ${canon(cd.expected)}${typeTag}`;
        };
        const cellTip = (cd) => {
            if (!cd) return '';
            const parts = [`tier: ${cd.tier}`];
            if (cd.delta !== null && cd.delta !== undefined) parts.push(`Δ ${cd.delta}`);
            if (cd.tolerance !== null && cd.tolerance !== undefined) parts.push(`ε ${cd.tolerance}`);
            if (cd.similarity !== null && cd.similarity !== undefined) parts.push(`similarity ${cd.similarity}`);
            // §15.9/§15.11 (1.5.1): the Δ/ε shown were decided in binary64, not exact decimal
            if (cd.exactFallback !== null && cd.exactFallback !== undefined) parts.push('binary64 fallback');
            return parts.join(' · ');
        };
        // row-level diff-check severities by check name (for the max-severity tint, §15.11)
        const rowCheckSev = {};
        for (const chk of ((runCfg.comparison || {}).diffChecks || {}).row || []) {
            rowCheckSev[chk.name] = chk.severity || 'error';
        }
        const cellSev = (cd, rd, colName) => {
            if (!cd) return '';
            let s = sev[cd.tier];
            for (const cf of rd.checkFails || []) {
                // a row-level diff-check entry touching this cell escalates its tint (§15.11)
                const cs = rowCheckSev[cf.name];
                if (cf.field === colName && cs && rankOf(cs) < rankOf(s)) s = cs;
            }
            return s === 'error' || s === 'warning' ? ' tint-' + s : '';
        };

        return h('div', {},
            filterBar(store, [], true, ['scope', 'matchStatus']),   // only the dimensions the diff carries
            h('div', { class: 'gridwrap' }, h('table', { class: 'grid diff' },
                h('tr', {}, ['match status', 'scope', ...shownCols].map((c) => h('th', {}, c))),
                shown.map((rd) => {
                    const orphanSev = rd.status === 'missing' ? sev.rowMissing : rd.status === 'unexpected' ? sev.rowUnexpected : null;
                    const rowTint = orphanSev === 'error' || orphanSev === 'warning' ? ' tint-' + orphanSev : '';
                    return h('tr', {},
                        h('td', { class: rowTint }, rd.status + (rd.similarity !== null && rd.similarity !== undefined ? ` (${rd.similarity.toFixed ? rd.similarity.toFixed(2) : rd.similarity})` : '')),
                        h('td', {}, rd.inScope ? 'in' : 'out'),
                        shownCols.map((c) => {
                            const cd = rd.cells[c];
                            return h('td', { class: cellSev(cd, rd, c), title: cellTip(cd) }, cellText(cd));
                        }));
                }))),
            capNote(shown.length, rows.length),
            res.diff.tableCheckFails.length ? h('div', {},
                h('h4', {}, 'Failed table-level diff checks (recorded regardless of severity — Core §15.9)'),
                res.diff.tableCheckFails.map((t) => h('div', { class: 'hint' }, `✖ ${t.name}${t.message ? ': ' + t.message : ''}`))) : null);
    }

    function rankOf(s) { return s === 'error' ? 0 : s === 'warning' ? 1 : 2; }

    function severityMapOf(runCfg) {
        const c = (runCfg && runCfg.comparison) || {};
        const setMode = (c.match && c.match.setMode) || 'exact';
        const base = {
            toleranceMatch: 'none', interpretedMatch: 'warning', fuzzyMatch: 'warning',
            crossTypeMismatch: 'error', valueMismatch: 'error',
            fuzzyKeyMatch: 'warning', ambiguousFuzzyMatch: 'warning',
            rowMissing: setMode === 'subset' ? 'none' : 'error',
            rowUnexpected: setMode === 'superset' ? 'none' : 'error',
            columnOnlyOnOneSide: 'error', exact: 'none',
        };
        return Object.assign(base, c.severity || {});
    }

    // Data view (§6): the produced table with per-cell tints from the register,
    // or — when observations were collected — the §9.5 outcome palette, with a
    // legend + explicit tint-mode toggle. Errors-view clicks land here (flashCell).
    function dataView(store) {
        const st = store.state;
        const res = st.run.result;
        const table = st.data.produced.table;
        if (!table) return h('div', { class: 'hint' }, 'No produced table in memory (re-upload on the Data tab).');
        const runCfg = st.run.runConfig;
        const isCompare = res.engine === 'compare';

        // logical column name → table column index, using the run config's effective
        // fieldNameMatching (byPosition = position)
        const fnm = Object.assign({ caseSensitive: false, trim: true, stripSpaces: false },
            (runCfg.structure && runCfg.structure.fieldNameMatching) || {});
        const norm = (s) => {
            let v = String(s);
            if (fnm.trim) v = v.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
            if (fnm.stripSpaces) v = v.replace(/\s+/g, '');
            if (!fnm.caseSensitive) v = v.toLowerCase();
            return v;
        };
        const colIndex = {};
        const names = Object.keys(runCfg.columns || {});
        const byPosition = runCfg.structure && runCfg.structure.columnMatching === 'byPosition';
        names.forEach((n, i) => {
            if (byPosition || !table.headers) colIndex[n] = i;
            else colIndex[n] = table.headers.findIndex((x) => norm(x) === norm(n));
        });

        // §6 tint modes: outcome palette (when collected) vs register severity, user-togglable
        const hasObs = !isCompare && Array.isArray(res.cellObservations);
        const hasReg = Array.isArray(res.cellRegister);
        const mode = st.ui.dataTint === 'auto' ? (hasObs ? 'outcome' : 'severity') : st.ui.dataTint;
        const useObs = mode === 'outcome' && hasObs;
        let tint = new Map();   // "row|colIdx" → class
        if (useObs) {
            for (const o of res.cellObservations) {
                const ci = colIndex[o.field];
                if (ci === undefined || ci < 0) continue;
                const cls = o.outcome === 'violation' ? 'tint-' + (o.worstSeverity || 'error')
                    : o.outcome === 'interpreted' ? 'tint-interpreted'
                    : o.outcome === 'effectivelyNull' ? 'tint-null'
                    : o.outcome === 'skipped' ? 'tint-skipped' : '';
                if (cls) tint.set(o.row + '|' + ci, cls);
            }
        } else if (hasReg) {
            for (const e of res.cellRegister) {
                if (e.row === null || e.field === null) continue;
                const ci = colIndex[e.field];
                if (ci === undefined || ci < 0) continue;
                const key = e.row + '|' + ci;
                const prev = tint.get(key);
                if (!prev || (e.severity === 'error' && prev !== 'tint-error')) tint.set(key, 'tint-' + e.severity);
            }
        }

        const legendChip = (cls, label) => h('span', { class: 'legend-chip' }, h('span', { class: 'swatch ' + cls }), label);
        const legend = h('div', { class: 'legend' },
            hasObs ? h('label', { class: 'inline' }, 'tinting ',
                h('select', { onchange: (e) => store.dispatch.setDataTint(e.target.value) },
                    h('option', { value: 'outcome', selected: mode === 'outcome' }, 'outcome palette (§9.5)'),
                    h('option', { value: 'severity', selected: mode === 'severity' }, 'register severity'))) : null,
            useObs
                ? [legendChip('tint-error', 'violation (error)'), legendChip('tint-warning', 'violation (warning)'),
                   legendChip('tint-interpreted', 'interpreted'), legendChip('tint-null', 'effectively null'),
                   legendChip('tint-skipped', 'skipped'), legendChip('', 'native / not checked')]
                : [legendChip('tint-error', 'error'), legendChip('tint-warning', 'warning'), legendChip('', 'no violation')],
            !hasObs && !isCompare ? h('span', { class: 'hint' }, ' — collect observations (Annotated XLSX output) for the full outcome palette') : null);

        // flash window (§6 errors-row cross-navigation): keep the target row visible even past the cap
        const flash = st.ui.flashCell;
        let start = 0;
        if (flash && flash.row >= ROW_CAP) start = Math.max(0, flash.row - 10);
        const shown = table.rows.slice(start, start + ROW_CAP);
        const flashCol = flash && flash.field !== null ? colIndex[flash.field] : undefined;

        const headers = table.headers || names.map((n) => n);
        return h('div', {},
            isCompare ? h('div', { class: 'hint' }, 'The produced table as ingested; comparison outcomes live in the Diff view.') : legend,
            h('div', { class: 'gridwrap' }, h('table', { class: 'grid' },
                h('tr', {}, ['#', headers].flat().map((c) => h('th', {}, c))),
                shown.map((row, si) => {
                    const ri = start + si;
                    const isFlashRow = flash && flash.row === ri;
                    return h('tr', { id: isFlashRow ? 'flash-row' : undefined },
                        h('td', { class: isFlashRow ? 'flash' : '' }, ri + 1),
                        headers.map((_, ci) => h('td', {
                            class: (tint.get(ri + '|' + ci) || '') + (isFlashRow && (flashCol === undefined || flashCol === ci) ? ' flash' : ''),
                        }, canon(row[ci]))));
                }))),
            start > 0 ? h('div', { class: 'hint' }, `window starts at row ${start + 1} (jumped from the Errors view)`) : null,
            capNote(shown.length, table.rows.length - start));
    }

    // ---------------- run-to-run delta view (§6 — the iterate-loop feature) ----------------
    // Violations keyed by (ruleName, row, field) from the register when both runs carried
    // one; otherwise a grouped (severity, ruleName, field) count-movement fallback.

    function deltaView(store) {
        const st = store.state;
        const prev = st.run.previous;
        const cur = st.run.result;
        if (!prev) {
            return h('div', { class: 'hint' },
                'No previous run in memory — the Δ view fills in after your next re-run (results are kept per session only).');
        }
        const move = (a, b) => a === b ? String(a) : `${a} → ${b}`;
        const header = h('div', { class: 'fields' },
            h('div', {}, h('b', {}, 'verdict '), move(prev.report.verdict, st.run.report.verdict),
                prev.mode !== st.run.mode ? h('span', { class: 'stale' }, ` (mode changed: ${prev.mode} → ${st.run.mode})`) : null),
            h('div', {}, h('b', {}, 'errors '), move(prev.result.summary.bySeverity.error, cur.summary.bySeverity.error),
                '  ', h('b', {}, 'warnings '), move(prev.result.summary.bySeverity.warning, cur.summary.bySeverity.warning)));

        const keyed = (res) => {
            if (!res.cellRegister) return null;
            const m = new Map();
            for (const e of res.cellRegister) {
                const k = `${e.ruleName}|${e.row === null ? '' : e.row}|${e.field === null ? '' : e.field}`;
                if (!m.has(k)) m.set(k, { key: k, entry: e, n: 0 });
                m.get(k).n++;
            }
            return m;
        };
        const pm = keyed(prev.result), cm = keyed(cur);
        if (pm && cm) {
            const added = [], resolved = [];
            let unchanged = 0;
            for (const [k, v] of cm) { if (!pm.has(k)) added.push(v); else unchanged++; }
            for (const [k, v] of pm) if (!cm.has(k)) resolved.push(v);
            const CAP = 200;
            const tbl = (rows, cls) => h('div', { class: 'gridwrap' }, h('table', { class: 'grid' },
                h('tr', {}, ['severity', 'check', 'row', 'column', 'message'].map((c) => h('th', {}, c))),
                rows.slice(0, CAP).map((v) => h('tr', { class: cls },
                    h('td', {}, v.entry.severity), h('td', {}, v.entry.ruleName),
                    h('td', {}, v.entry.row === null ? '—' : v.entry.row + 1),
                    h('td', {}, v.entry.field === null ? '—' : v.entry.field),
                    h('td', {}, v.entry.message)))));
            return h('div', {},
                header,
                h('div', { class: 'hint' }, `keyed by (ruleName, row, field): ${added.length} new · ${resolved.length} resolved · ${unchanged} unchanged`),
                added.length ? h('div', {}, h('b', { class: 'bad' }, `new (${added.length})`), tbl(added, 'delta-new')) : null,
                resolved.length ? h('div', {}, h('b', { class: 'ok' }, `resolved (${resolved.length})`), tbl(resolved, 'delta-resolved')) : null,
                !added.length && !resolved.length ? h('div', { class: 'ok' }, 'No violation movement between the two runs.') : null,
                (added.length > CAP || resolved.length > CAP) ? h('div', { class: 'hint' }, `showing the first ${CAP} per list`) : null);
        }
        // group-level fallback (a run without the register still gets count movement)
        const groups = new Map();
        const addSide = (res, side) => {
            for (const d of res.summary.details) {
                const k = `${d.severity}|${d.ruleName}|${d.fieldName === null ? '' : d.fieldName}`;
                if (!groups.has(k)) groups.set(k, { d, prev: 0, cur: 0 });
                groups.get(k)[side] += d.count;
            }
        };
        addSide(prev.result, 'prev'); addSide(cur, 'cur');
        const rows = [...groups.values()].filter((g) => g.prev !== g.cur);
        return h('div', {},
            header,
            h('div', { class: 'hint' }, 'register not collected on both runs — grouped count movement (enable "Errors view" for per-cell deltas)'),
            rows.length ? h('div', { class: 'gridwrap' }, h('table', { class: 'grid' },
                h('tr', {}, ['severity', 'check', 'column', 'entries'].map((c) => h('th', {}, c))),
                rows.map((g) => h('tr', {},
                    h('td', {}, g.d.severity), h('td', {}, g.d.ruleName),
                    h('td', {}, g.d.fieldName === null ? '—' : g.d.fieldName),
                    h('td', {}, `${g.prev} → ${g.cur}`)))))
                : h('div', { class: 'ok' }, 'No group-level movement between the two runs.'));
    }

    // ---------------- export bar (§4.3 dual guard, §6 matrix) ----------------

    function exportBar(store) {
        const st = store.state;
        const res = st.run.result;
        const isCompare = res.engine === 'compare';
        const name = (st.run.runConfig.meta && st.run.runConfig.meta.name) || 'run';
        const guard = (ok, why, label, fn) => h('button', { disabled: !ok, title: ok ? '' : why, onclick: fn }, label);
        const dl = NS.download;
        const tpl = NS.parseTemplates(st);
        const mt = tpl.map || undefined;   // same overrides the run used (§3.5)
        return h('div', { class: 'exportbar' },
            'Export: ',
            guard(true, '', 'Result JSON', () => dl(`${name}-result.json`, JSON.stringify(res, null, 2), 'application/json')),
            guard(true, '', 'Run config JSON', () => dl(`${name}-run-config.json`, JSON.stringify(st.run.runConfig, null, 2), 'application/json')),
            !isCompare ? guard(!!res.cellRegister, 'needs the register — enable "Errors view"/"XLSX report" and re-run', 'XLSX report',
                () => TV().exportXlsx({ result: res, table: st.data.produced.table, schema: st.run.runConfig, messageTemplates: mt })
                    .then((b) => dl(`${name}-report.xlsx`, b)).catch((e) => store.dispatch.noticeAdd('error', e.message))) : null,
            !isCompare ? guard(!!res.cellObservations, 'needs observations — enable "Annotated XLSX" and re-run', 'Annotated XLSX',
                () => TV().exportAnnotatedXlsx({ result: res, table: st.data.produced.table, schema: st.run.runConfig, messageTemplates: mt })
                    .then((b) => dl(`${name}-annotated.xlsx`, b)).catch((e) => store.dispatch.noticeAdd('error', e.message))) : null,
            isCompare ? guard(!!res.diff && !!res.cellRegister, 'needs diff + register', 'Comparison XLSX',
                () => TV().exportComparisonXlsx({ result: res, table: st.data.produced.table, produced: st.data.produced.table, schema: st.run.runConfig, expected: st.data.expected.table, messageTemplates: mt })
                    .then((b) => dl(`${name}-comparison.xlsx`, b)).catch((e) => store.dispatch.noticeAdd('error', e.message))) : null);
    }

    // ---------------- results shell ----------------

    NS.ResultsView = function (store) {
        const st = store.state;
        if (!st.run.result) {
            // §9: directive empty state — the exact unmet predicates, each linking to its tab
            const r = store.readiness();
            const links = { Data: 'data', Schema: 'schema', Comparison: 'comparison' };
            return h('div', { class: 'card' },
                h('div', { class: 'hint big' }, r.canValidate
                    ? 'Ready — press Validate above.'
                    : 'No run yet. Unmet preconditions:'),
                !r.canValidate ? r.reasons.validate.map((reason) => {
                    const target = Object.keys(links).find((k) => reason.includes(k)) || (reason.includes('Data tab') ? 'Data' : reason.includes('Schema') ? 'Schema' : null);
                    return h('div', { class: 'hint' }, '· ', reason, ' ',
                        target ? h('button', { class: 'mini', onclick: () => store.dispatch.setTab(links[target]) }, `go to ${target}`) : null);
                }) : null);
        }
        const isCompare = st.run.result.engine === 'compare';
        const views = [['report', 'Report'], ['summary', 'Summary'], ['errors', 'Errors'],
            ...(isCompare ? [['diff', 'Diff']] : []), ['data', 'Data'],
            ...(st.run.previous ? [['delta', 'Δ Delta']] : [])];
        const tab = (key, label) => h('button', {
            class: 'tab' + (st.ui.resultView === key ? ' active' : ''),
            onclick: () => store.dispatch.setResultView(key),
        }, label);
        const body = { report: reportView, summary: summaryView, errors: errorsView, diff: diffView, data: dataView, delta: deltaView }[st.ui.resultView] || reportView;
        return h('div', { class: 'card results' },
            h('div', { class: 'card-title' },
                `Results — ${st.run.mode}` , st.run.stale ? h('span', { class: 'stale' }, ' (stale)') : null),
            h('div', { class: 'subtabs' }, views.map(([k, l]) => tab(k, l))),
            exportBar(store),
            h('div', { class: 'result-body' }, body(store)));
    };

    // ---------------- advanced mode (§9): per-session custom functions ----------------
    // Deliberately explicit: a plain-language warning, an opt-in checkbox, and paste-in
    // sources compiled with the Function constructor ONLY while the mode is enabled.
    // Never persisted; off after every reload.

    function advancedCard(store) {
        const st = store.state;
        const a = st.advanced;
        const adv = NS.compileAdvanced(st);
        const referenced = (st.authoring.lastValidation && st.authoring.lastValidation.deferred) || [];
        return h('div', { class: 'card' },
            h('div', { class: 'card-title' }, 'Advanced mode — custom functions (per-session)'),
            h('div', { class: 'notice warn' },
                'Pasted code runs in this page with full access to everything the console can reach. ',
                'Paste only code you trust. Functions live for this session only — they are never saved, ',
                'never exported with configs or workspaces, and advanced mode is off again after a reload. ',
                'Runs that use them execute on the main thread (functions cannot cross the worker boundary).'),
            h('label', { class: 'inline' },
                h('input', { type: 'checkbox', checked: a.enabled, onchange: (e) => store.dispatch.advancedSetEnabled(e.target.checked) }),
                ' enable advanced mode for this session'),
            !a.enabled && referenced.length
                ? h('div', { class: 'hint' }, `This config defers rules ${referenced.join(', ')} (custom functions). Enable advanced mode and paste the function code to run it here — or run it via the API.`)
                : null,
            a.enabled ? h('div', {},
                a.sources.map((src, i) => h('div', { class: 'check-entry' },
                    h('label', {}, 'function name ',
                        h('input', { type: 'text', class: 'narrow', value: src.name, placeholder: 'e.g. myCheck', onchange: (e) => store.dispatch.advancedEdit(i, 'name', e.target.value) })),
                    h('button', { class: 'mini danger', title: 'remove function', onclick: () => store.dispatch.advancedRemove(i) }, '×'),
                    h('textarea', {
                        class: 'fnsrc', rows: 4, spellcheck: 'false',
                        placeholder: '(row, interpreted, rowIndex, params) => interpreted[params.field] > 0 ? [] : [{ field: params.field, pass: false, message: "must be positive" }]',
                        onchange: (e) => store.dispatch.advancedEdit(i, 'src', e.target.value),
                    }, src.src))),
                h('button', { class: 'mini', onclick: () => store.dispatch.advancedAdd() }, '+ function'),
                adv.errors.length ? h('div', { class: 'notice error' },
                    adv.errors.map((er) => h('div', {}, `"${er.name}" does not compile: ${er.message}`))) : null,
                adv.count ? h('div', { class: 'hint' }, `${adv.count} function(s) registered for this session — authoring rule 30 is now checked against them.`) : null) : null);
    }

    NS.RunTab = function (store) {
        return h('section', {}, NS.RunPanel(store), advancedCard(store), NS.ResultsView(store));
    };
})(globalThis);
