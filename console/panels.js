/* Authoring & Run Console — header/rail, Data, Schema, Comparison panels
 * (UI arch §3.1 layout, §5 component contracts). */
'use strict';
(function (global) {
    const NS = global.TVConsole = global.TVConsole || {};
    const TV = () => global.TableValidation;
    const h = (...a) => NS.h(...a);

    const TYPE_NAMES = ['string', 'int', 'float', 'decimal', 'bool', 'datetime', 'date', 'time', 'categorical', 'skip'];
    const fmtBytes = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MiB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KiB' : n + ' B';

    // Field-rendering context bound to the store (SettingField contract, §5)
    function fieldCtx(store, colName) {
        const b = store.state.authoring.builder;
        return {
            get: (path) => b.get(path),
            edit: (path, value) => store.dispatch.edit(path, value),
            preview: store.state.authoring.preview,
            colName: colName !== undefined ? colName : null,
            colPath: colName !== undefined && colName !== null
                ? (generic) => generic.replace(/<name>|<col>/g, colName) : null,
        };
    }
    NS.fieldCtx = fieldCtx;

    // ---------------- notices ----------------

    NS.Notices = function (store) {
        const st = store.state;
        return h('div', {},
            st.ui.persistFailed ? h('div', { class: 'notice warn' },
                'localStorage is unavailable — the console keeps working, but the config library will not survive a reload. Use Download to keep your work.') : null,
            st.ui.notices.map((n, i) => h('div', { class: 'notice ' + n.kind },
                n.text, ' ', h('button', { class: 'mini', onclick: () => store.dispatch.dismissNotice(i) }, '×'))));
    };

    // ---------------- ConfigLibraryBar (§5) ----------------

    NS.HeaderBar = function (store) {
        const st = store.state;
        const active = st.configs.entries.find((e) => e.id === st.configs.activeId) || null;
        const dirty = st.authoring.dirtySinceSave;
        const name = (st.authoring.doc.meta && st.authoring.doc.meta.name) || '(unnamed)';

        const picker = h('select', {
            'aria-label': 'active config (switch or create)',
            onchange: (e) => {
                const v = e.target.value;
                if (v === '') return;
                const go = () => v === '_new' ? store.dispatch.configNew() : store.dispatch.configLoad(v);
                if (dirty) {
                    e.target.value = 'keep';
                    store.dispatch.dialogOpen({ kind: 'confirm', title: 'Unsaved changes', danger: true,
                        text: 'The current draft has unsaved changes. Switch anyway?', okLabel: 'Switch', onOk: go });
                    return;
                }
                go();
            },
        },
            h('option', { value: 'keep', selected: true }, `Config: ${name}${dirty ? ' *' : ''}${active ? '' : ' (unsaved)'}`),
            h('option', { value: '_new' }, '— New config —'),
            st.configs.entries.map((e) => h('option', { value: e.id },
                `${e.name}  (${e.updatedAt ? e.updatedAt.slice(0, 16).replace('T', ' ') : ''})`)));

        const importInput = h('input', {
            type: 'file', accept: '.json,application/json', style: 'display:none',
            onchange: (e) => {
                const f = e.target.files[0];
                if (f) f.text().then((t) => store.dispatch.configImport(t, f.name));
                e.target.value = '';
            },
        });
        const wsImportInput = h('input', {
            type: 'file', accept: '.json,application/json', style: 'display:none',
            onchange: (e) => {
                const f = e.target.files[0];
                if (f) f.text().then((t) => store.dispatch.workspaceImport(t, f.name));
                e.target.value = '';
            },
        });

        // "Copy section from…" (§2.1 reuse convenience)
        const copyFrom = h('select', { 'aria-label': 'copy a section from another saved config', onchange: (e) => { if (!e.target.value) return; const [id, sec] = e.target.value.split('||'); store.dispatch.copySectionFrom(id, sec); e.target.value = ''; } },
            h('option', { value: '', selected: true }, 'Copy section from…'),
            st.configs.entries.filter((e) => e.id !== st.configs.activeId).flatMap((e) =>
                ['comparison', 'structure', 'nullHandling', 'evaluation', 'resultConfig']
                    .filter((sec) => e.config[sec] !== undefined)
                    .map((sec) => h('option', { value: `${e.id}||${sec}` }, `${e.name} → ${sec}`))));

        return h('header', {},
            h('span', { class: 'brand' }, 'Table Validation Console ', h('small', {}, `v${TV().VERSION}`)),
            picker,
            h('button', { onclick: () => store.dispatch.configSave() }, dirty ? 'Save *' : 'Save'),
            h('button', { onclick: () => store.dispatch.configDuplicate() }, 'Duplicate'),
            h('button', { onclick: () => importInput.click() }, 'Import'), importInput,
            h('button', { onclick: () => NS.download(`${name || 'config'}.json`, JSON.stringify(st.authoring.doc, null, 2), 'application/json') }, 'Download'),
            copyFrom,
            active ? h('button', {
                class: 'danger',
                onclick: () => store.dispatch.dialogOpen({ kind: 'confirm', title: 'Delete config', danger: true,
                    text: `Delete saved config "${active.name}"? (This removes it from the library; exported files are unaffected.)`,
                    okLabel: 'Delete', onOk: () => store.dispatch.configDelete(active.id) }),
            }, 'Delete') : null,
            h('span', { class: 'hdr-gap' }),
            // §5 polish: bounded undo/redo over builder snapshots
            h('button', { class: 'mini', disabled: !st.authoring.history.past.length, title: 'undo the last config edit', onclick: () => store.dispatch.undo() }, '↶ undo'),
            h('button', { class: 'mini', disabled: !st.authoring.history.future.length, title: 'redo', onclick: () => store.dispatch.redo() }, '↷ redo'),
            // §2.3 workspace bundle: config + ingest specs + data stubs + outputs + referenceInstant
            h('button', { title: 'One JSON bundle: active config, ingest specs, data-slot stubs (not the data), requested outputs, referenceInstant', onclick: () => NS.download(`${name || 'workspace'}-workspace.json`, store.dispatch.workspaceExportJson(), 'application/json') }, 'Export workspace'),
            h('button', { onclick: () => wsImportInput.click() }, 'Import workspace'), wsImportInput);
    };

    NS.download = function (fileName, content, mime) {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    // ---------------- readiness rail (§2.2, §3.1) ----------------

    NS.Rail = function (store) {
        const st = store.state;
        const r = store.readiness();
        const v = st.authoring.lastValidation;
        const badge = {
            data: st.data.produced.status === 'ready'
                ? (st.authoring.comparisonEnabled && st.data.expected.status !== 'ready' ? '⚠ expected missing' : '✓')
                : '○',
            schema: v ? (v.valid ? (v.advisories.length ? `✓ ⚠${v.advisories.length}` : '✓') : `⚠${v.errors.length}`) : '○',
            comparison: st.authoring.comparisonEnabled ? '✓ on' : '○ off',
            run: st.run.result ? (st.run.stale ? '⚠ stale' : '✓') : (r.canValidate ? '▶ ready' : '○'),
        };
        const tab = (key, label) => h('button', {
            class: 'tab' + (st.ui.activeTab === key ? ' active' : ''),
            onclick: () => store.dispatch.setTab(key),
        }, `${label}  ${badge[key]}`);
        return h('nav', {},
            tab('data', '① Data'), tab('schema', '② Schema'),
            tab('comparison', '③ Comparison'), tab('run', '④ Run & Results'));
    };

    // ---------------- Data panel (§2.3, §5 DataSlotCard) ----------------

    // §B.8 normalization step-list editor — rendered from TableValidation.normalizationModel
    // (a registry descriptor: fn picker + params), never from a hard-coded function list.
    function normStepRow(store, slotName, steps, i, tableLevel) {
        const model = global.TableValidation.normalizationModel;
        const step = steps[i];
        const desc = model.find((m) => m.fn === step.fn);
        const placeholder = desc && desc.params.length
            ? '{' + desc.params.map((pd) => `"${pd.name}": ${pd.required ? '…' : JSON.stringify(pd.default)}`).join(', ') + '}'
            : '(no params)';
        const mut = (fn) => store.dispatch.mutateIngestForm(slotName, fn);
        return h('div', { class: 'inline-opts' },
            h('select', {
                title: desc ? desc.doc : '',
                onchange: (e) => mut(() => { step.fn = e.target.value; step.params = ''; }),
            }, model.filter((m) => !tableLevel || !m.perColumnOnly)
                .map((m) => h('option', { value: m.fn, selected: step.fn === m.fn, title: m.doc }, m.fn))),
            h('input', {
                type: 'text', class: 'json', value: step.params, placeholder,
                title: desc ? desc.doc + (desc.params.length ? ' Params: ' + desc.params.map((pd) => `${pd.name} (${pd.type}${pd.required ? ', required' : ''})`).join(', ') : '') : 'params (JSON)',
                onchange: (e) => mut(() => { step.params = e.target.value; }),
            }),
            i > 0 ? h('button', { class: 'mini', title: 'move up', onclick: () => mut(() => { steps.splice(i - 1, 0, steps.splice(i, 1)[0]); }) }, '↑') : null,
            h('button', { class: 'mini danger', title: 'remove step', onclick: () => mut(() => { steps.splice(i, 1); }) }, '×'));
    }

    function normalizationEditor(store, slotName, f) {
        if (!global.TableValidation.normalizationModel) return null;
        const nm = f.norm;
        const mut = (fn) => store.dispatch.mutateIngestForm(slotName, fn);
        const addStep = (steps) => mut(() => { steps.push({ fn: 'trim', params: '' }); });
        return h('details', { class: 'norm-editor', open: nm.table.length || nm.columns.length ? true : undefined },
            h('summary', {}, `normalization (§B.8) — ${nm.table.length} table step(s), ${nm.columns.length} column rule(s)`),
            h('div', { class: 'hint' },
                'Opt-in transform stage between parse and the emitted table. Steps run in order: all table-level steps, then each column’s steps. Headers are never normalized; unparseable content passes through unchanged for validate() to catch.'),
            h('div', {},
                h('b', {}, 'table steps '), h('button', { class: 'mini', onclick: () => addStep(nm.table) }, '+ step'),
                nm.table.map((_, i) => normStepRow(store, slotName, nm.table, i, true))),
            h('div', {},
                h('b', {}, 'per-column steps '),
                h('button', { class: 'mini', onclick: () => mut(() => { nm.columns.push({ key: '', steps: [] }); }) }, '+ column rule'),
                nm.columns.map((cr, ci) => h('div', { class: 'check-entry' },
                    h('label', {}, 'column (header name, or 0-based position for headerless) ',
                        h('input', { type: 'text', class: 'narrow', value: cr.key, onchange: (e) => mut(() => { cr.key = e.target.value; }) })),
                    h('button', { class: 'mini', onclick: () => addStep(cr.steps) }, '+ step'),
                    h('button', { class: 'mini danger', title: 'remove column rule', onclick: () => mut(() => { nm.columns.splice(ci, 1); }) }, '×'),
                    cr.steps.map((_, i) => normStepRow(store, slotName, cr.steps, i, false))))));
    }

    function ingestSpecForm(store, slotName, slot) {
        const set = (k) => (e) => store.dispatch.setIngestForm(slotName, k, e.target.value);
        const f = slot.form;
        const sel = (k, options) => h('select', { onchange: set(k) },
            options.map((o) => h('option', { value: o, selected: f[k] === o }, o)));
        const txt = (k, ph, cls) => h('input', { type: 'text', class: cls || 'narrow', value: f[k], placeholder: ph || '', onchange: set(k) });
        const isCsv = f.format === 'csv' || f.format === 'tsv';
        return h('div', { class: 'ingest-form' },
            h('div', { class: 'hint' }, 'Nothing is sniffed — confirm the format and options (Addendum §B.1):'),
            h('label', {}, 'format ', sel('format', ['csv', 'tsv', 'xlsx', 'jsonArrays', 'jsonObjects'])),
            f.format !== 'jsonObjects' ? h('label', {}, 'header ', sel('headerMode', ['firstRow', 'none', 'explicit'])) : null,
            f.headerMode === 'explicit' && f.format !== 'jsonObjects' ? h('label', {}, 'names (JSON) ', txt('headerNames', '["a","b"]', 'json')) : null,
            f.format === 'csv' ? h('label', {}, 'delimiter ', txt('delimiter')) : null,
            isCsv ? h('label', {}, 'quote ', txt('quote')) : null,
            isCsv ? h('label', {}, 'encoding ', txt('encoding', 'auto')) : null,
            f.format === 'xlsx' ? h('label', {}, 'sheet (name or 0-based index) ', txt('sheet')) : null,
            h('label', { title: 'Drop N leading parsed rows BEFORE header handling (report titles above the real header)' },
                'skip leading rows ', txt('skipRows', '0')),
            h('label', { title: 'Drop N trailing data rows (totals/footer rows)' },
                'skip footer rows ', txt('skipFooterRows', '0')),
            h('label', {}, 'limits (JSON, optional) ', txt('limits', '{"maxRows":1000000}', 'json')),
            normalizationEditor(store, slotName, f),
            h('button', { class: 'primary', onclick: () => store.dispatch.ingest(slotName) }, 'Ingest'));
    }

    function ingestErrorHelp(code) {
        // §9: canonical code → targeted next step
        return {
            formatMismatch: 'Check the format selection — nothing is auto-detected.',
            encodingUnsupported: 'The encoding label is not supported; check the encoding field.',
            decodingFailed: 'The bytes do not match the declared encoding (explicit encodings never fall back); check the encoding field.',
            sheetNotFound: 'The sheet name/index does not exist — see the available sheets below.',
            ingestSpecInvalid: 'Fix the highlighted IngestSpec fields.',
            sourceUnreadable: 'The file could not be read — try re-selecting it.',
            normalizationFunctionError: 'A normalization function threw — see the detail for the function, row, and column.',
            normalizationFunctionContractViolation: 'A normalization function returned a non-scalar value — normalization functions must return string, number, boolean, or null.',
        }[code] || (code && code.startsWith('limitExceeded') ? 'The source exceeds a configured limit; raise it in the limits field (limits fail fast, never truncate).' : '');
    }

    function slotCard(store, slotName, title) {
        const slot = store.state.data[slotName];
        const fileInput = h('input', {
            type: 'file', style: 'display:none',
            onchange: (e) => {
                const f = e.target.files[0];
                e.target.value = '';
                if (!f) return;
                // §2.3: re-uploading replaces the slot only after confirmation
                if (slot.status !== 'ready') { store.dispatch.pickFile(slotName, f); return; }
                store.dispatch.dialogOpen({ kind: 'confirm', title: 'Replace file', danger: true,
                    text: 'Replacing the file discards the currently ingested table (results become stale). Continue?',
                    okLabel: 'Replace', onOk: () => store.dispatch.pickFile(slotName, f) });
            },
        });
        const pasteArea = h('textarea', {
            class: 'fnsrc', rows: 5, spellcheck: 'false',
            placeholder: 'Paste CSV/TSV text, a JSON array of rows, or a JSON array of records — the pasted text is the ingest source (confirm the IngestSpec below, nothing is sniffed beyond a format suggestion).',
        });
        const pasteBox = h('details', {},
            h('summary', {}, 'Paste data instead of a file'),
            pasteArea,
            h('div', {}, h('button', { class: 'mini primary', onclick: () => {
                if (!pasteArea.value.trim()) return;
                if (slot.status === 'ready') {
                    store.dispatch.dialogOpen({ kind: 'confirm', title: 'Replace data', danger: true,
                        text: 'Replacing the data discards the currently ingested table (results become stale). Continue?',
                        okLabel: 'Replace', onOk: () => store.dispatch.pasteText(slotName, pasteArea.value) });
                    return;
                }
                store.dispatch.pasteText(slotName, pasteArea.value);
            } }, 'Use pasted text')));
        const parts = [
            h('div', { class: 'card-title' }, title, ' ',
                h('button', { onclick: () => fileInput.click() }, slot.status === 'empty' ? 'Upload file' : 'Replace file'), fileInput,
                slot.status !== 'empty' ? h('button', { class: 'mini', onclick: () => store.dispatch.clearSlot(slotName) }, 'clear') : null),
            pasteBox,
        ];
        if (slot.stub && slot.status === 'empty') {
            parts.push(h('div', { class: 'hint' },
                `Previous session used "${slot.stub.fileMeta.name}" (${fmtBytes(slot.stub.fileMeta.sizeBytes)}${slot.stub.provenance ? `, ${slot.stub.provenance.format}, ${slot.stub.provenance.rowCount}×${slot.stub.provenance.columnCount}` : ''}). Table data is not persisted — re-upload it.`));
        }
        if (slot.fileMeta && slot.status !== 'empty') {
            parts.push(h('div', { class: 'hint' }, `${slot.fileMeta.name} (${fmtBytes(slot.fileMeta.sizeBytes)})`));
        }
        if (slot.status === 'picked') parts.push(ingestSpecForm(store, slotName, slot));
        if (slot.status === 'ingesting') parts.push(h('div', {}, 'Ingesting…'));
        if (slot.status === 'failed' && slot.error) {
            parts.push(h('div', { class: 'notice error' },
                h('b', {}, slot.error.code || slot.error.name || 'error'), ` — ${slot.error.message}`,
                h('div', { class: 'hint' }, ingestErrorHelp(slot.error.code)),
                slot.error.detail ? h('pre', {}, JSON.stringify(slot.error.detail, null, 2)) : null));
            parts.push(ingestSpecForm(store, slotName, slot));
        }
        if (slot.status === 'ready') {
            const p = slot.provenance;
            const na = slot.normalizationActions;
            parts.push(h('div', { class: 'prov' },
                `✓ ${p.format} · ${p.rowCount} rows × ${p.columnCount} cols · header: ${p.headerMode}` +
                (p.encodingUsed ? ` · encoding: ${p.encodingUsed}` : '') +
                (p.sheetName ? ` · sheet: ${p.sheetName}` : '') +
                (p.delimiter ? ` · delimiter: ${JSON.stringify(p.delimiter)}` : '') +
                (p.skippedRows ? ` · skipped ${p.skippedRows} leading row(s)` : '') +
                (p.skippedFooterRows ? ` · skipped ${p.skippedFooterRows} footer row(s)` : '') +
                (na !== null && na !== undefined
                    ? ` · normalized: ${na.length ? na.map((a) => `${a.fn}×${a.count} (${a.column})`).join(', ') : 'no cells changed'}`
                    : '')));
            if (slot.warnings.length) {
                parts.push(h('details', {}, h('summary', {}, `${slot.warnings.length} ingest warning(s) — lossy-mapping facts, not data-quality judgments`),
                    h('table', { class: 'grid' },
                        h('tr', {}, ['code', 'message', 'row', 'column', 'count'].map((c) => h('th', {}, c))),
                        slot.warnings.map((w) => h('tr', {},
                            h('td', {}, w.code), h('td', {}, w.message),
                            h('td', {}, w.row === null ? '—' : w.row + 1), h('td', {}, w.column === null ? '—' : w.column + 1),
                            h('td', {}, w.count))))));
            }
        }
        return h('div', { class: 'card' }, parts);
    }

    function inferenceBanner(store) {
        const st = store.state;
        if (st.data.produced.status !== 'ready') return null;
        const noColumns = Object.keys(st.authoring.doc.columns || {}).length === 0;
        const o = st.inference.options;
        const optRow = h('div', { class: 'inline-opts' },
            h('label', { class: 'inline' }, 'sampleRows ', h('input', { type: 'text', class: 'narrow', value: String(o.sampleRows), onchange: (e) => store.dispatch.setInferOption('sampleRows', parseInt(e.target.value, 10) || 1000) })),
            h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: o.suggestRanges, onchange: (e) => store.dispatch.setInferOption('suggestRanges', e.target.checked) }), 'suggest ranges'),
            h('label', { class: 'inline', title: 'Draft observed decimal-precision bounds on inferred float columns (Addendum §C.7; default on — decimal places are contract-like). Precision is a shared key of the float and decimal types (Core §6.3/§6.10); decimal is never inferred (§C.4).' },
                h('input', { type: 'checkbox', checked: o.suggestPrecision, onchange: (e) => store.dispatch.setInferOption('suggestPrecision', e.target.checked) }), 'suggest precision'),
            h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: o.seedComparison, onchange: (e) => store.dispatch.setInferOption('seedComparison', e.target.checked) }), 'seed comparison'),
            h('label', { class: 'inline', title: 'Draft every accepting temporal format (winner first); mixed-format date columns infer via union coverage (Addendum §C.4)' },
                h('input', { type: 'checkbox', checked: o.allAcceptingFormats, onchange: (e) => store.dispatch.setInferOption('allAcceptingFormats', e.target.checked) }), 'all accepting formats'),
            h('label', { class: 'inline', title: 'Evaluate EVERY row instead of the sampleRows prefix (Addendum §C.2) — conclusions become facts of the whole table; slower on very large tables' },
                h('input', { type: 'checkbox', checked: o.exhaustive, onchange: (e) => store.dispatch.setInferOption('exhaustive', e.target.checked) }), 'exhaustive (all rows)'),
            h('button', { class: 'primary', onclick: () => store.dispatch.inferRun() },
                noColumns ? 'Infer draft config' : 'Re-infer (replaces the draft)'));

        const offer = st.inference.status === 'offered' && st.inference.offer ? renderInferOffer(store) : null;
        return h('div', { class: 'card' },
            h('div', { class: 'card-title' }, 'Inference', noColumns ? ' — no config columns yet; draft one from this data?' : ''),
            h('div', { class: 'hint' }, 'A draft is a suggestion, never authoritative — you review and accept it explicitly (Addendum §C).'),
            optRow, offer);
    }

    // §5 one-click adoption: each button is a NORMAL builder edit against the ACTIVE
    // config (visible in authoring validation immediately) — never an auto-application.
    function adoptionButtons(store, report) {
        const st = store.state;
        const doc = st.authoring.doc;
        const cols = doc.columns || {};
        const buttons = [];
        for (const c of report.candidateKeys) {
            const have = cols[c] !== undefined;
            const already = have && cols[c].unique && cols[c].unique.enabled === true;
            buttons.push(h('button', {
                class: 'mini', disabled: !have || already,
                title: !have ? `the active config has no column "${c}"` : already ? 'already enabled' : `columns.${c}.unique.enabled = true`,
                onclick: () => store.dispatch.edit(`columns.${c}.unique.enabled`, true),
            }, `enable uniqueness on "${c}"`));
        }
        for (const t of report.suggestions.tolerances) {
            const ok = st.authoring.comparisonEnabled && cols[t.column] !== undefined;
            buttons.push(h('button', {
                class: 'mini', disabled: !ok,
                title: !st.authoring.comparisonEnabled ? 'comparison is off (③) — tolerances live in the comparison section'
                    : cols[t.column] === undefined ? `the active config has no column "${t.column}"`
                        : `comparison.fields.${t.column}.tolerance = ${t.suggested} (${t.basis})`,
                onclick: () => store.dispatch.edit(`comparison.fields.${t.column}.tolerance`, t.suggested),
            }, `tolerance ±${t.suggested} on "${t.column}"`));
        }
        const haveTokens = new Set((doc.nullHandling && doc.nullHandling.nullEquivalents) || []);
        const seen = new Set();
        for (const rc of report.columns) for (const tok of Object.keys(rc.observed.nullTokensSeen || {})) seen.add(tok);
        for (const tok of seen) {
            if (haveTokens.has(tok)) continue;
            buttons.push(h('button', {
                class: 'mini',
                title: `nullHandling.nullEquivalents += ${JSON.stringify(tok)} (observed in the sample, not in the active config)`,
                onclick: () => store.dispatch.edit('nullHandling.nullEquivalents',
                    ((store.state.authoring.doc.nullHandling && store.state.authoring.doc.nullHandling.nullEquivalents) || []).concat([tok])),
            }, `add ${JSON.stringify(tok)} to nullEquivalents`));
        }
        if (!buttons.length) return null;
        return h('div', {},
            h('div', { class: 'hint' }, 'One-click adoption into the ACTIVE config (each is a normal builder edit):'),
            h('div', { class: 'inline-opts' }, buttons));
    }

    function renderInferOffer(store) {
        const { draft, report } = store.state.inference.offer;
        const accept = () => {
            const hasCols = Object.keys(store.state.authoring.doc.columns || {}).length > 0;
            if (!hasCols) { store.dispatch.inferAccept(); return; }
            store.dispatch.dialogOpen({ kind: 'confirm', title: 'Use draft', danger: true,
                text: 'Using the draft replaces the current column definitions. Continue?',
                okLabel: 'Use draft', onOk: () => store.dispatch.inferAccept() });
        };
        return h('div', { class: 'offer' },
            h('div', {}, h('b', {}, `Draft ready`), ` — sampled ${report.sample.rowsSampled} of ${report.sample.rowsAvailable} rows`,
                report.limitations.length ? h('span', { class: 'hint' }, ` · limitations: ${report.limitations.join(', ')}`) : null),
            h('table', { class: 'grid' },
                h('tr', {}, ['column', 'type', 'confidence', 'reasons', 'alternatives', 'nulls', 'distinct', 'key?'].map((c) => h('th', {}, c))),
                report.columns.map((c) => h('tr', {},
                    h('td', {}, c.name),
                    h('td', {}, c.inferredType + (draft.columns[c.name].type.formats ? ` (${JSON.stringify(draft.columns[c.name].type.formats)})` : '')),
                    h('td', { class: 'conf-' + c.confidence }, c.confidence),
                    h('td', {}, c.reasons.join(', ') || '—'),
                    h('td', {}, c.alternatives.map((a) => `${a.type}${a.formats ? ' ' + a.formats.join('|') : ''}`).join(', ') || '—'),
                    h('td', {}, c.observed.nulls), h('td', {}, c.observed.distinctCount),
                    h('td', {}, c.candidateKey ? '●' : '')))),
            report.candidateKeys.length ? h('div', { class: 'hint' }, `candidate keys: ${report.candidateKeys.join(', ')}`) : h('div', { class: 'hint' }, 'no single-column key candidate'),
            report.suggestions.tolerances.length ? h('div', { class: 'hint' }, 'suggested tolerances (report-only): ' + report.suggestions.tolerances.map((t) => `${t.column}: ${t.suggested}`).join(', ')) : null,
            // §C.8 (1.6.0): the report-only decimal-type pointer beside the tolerance line —
            // the decimal type (Core §6.10) expresses a money-shaped column exactly, no flags.
            // Adoption is authorial (decimal is never drafted, §C.4), so no one-click button.
            report.suggestions.types.length ? h('div', { class: 'hint' }, 'suggested types (report-only, §C.8): ' + report.suggestions.types.map((t) => `${t.column} → ${t.suggested}`).join(', ') + ' — the decimal type (Core §6.10) expresses the column contract with exact verdicts, no tolerance machinery') : null,
            // §C.7 (1.4.0): report-only NumberFormat pattern suggestion(s) — an authorial
            // spelling contract, never drafted (rule N4), so likewise informational only.
            report.suggestions.patterns.length ? h('div', { class: 'hint' }, 'suggested patterns (report-only, §C.7): ' + report.suggestions.patterns.map((p) => `${p.column}: ${p.suggested}`).join(', ')) : null,
            adoptionButtons(store, report),
            h('div', {},
                h('button', { class: 'primary', onclick: accept }, 'Use draft'),
                h('button', { onclick: () => store.dispatch.inferDismiss() }, 'Dismiss'),
                h('button', { onclick: () => NS.download('inference-report.json', JSON.stringify(report, null, 2), 'application/json') }, 'Download report')));
    }

    NS.DataPanel = function (store) {
        const st = store.state;
        const empty = st.data.produced.status === 'empty' && Object.keys(st.authoring.doc.columns || {}).length === 0;
        return h('section', {},
            empty ? h('div', { class: 'hint big' }, 'Fastest path: upload a produced table → Infer draft config → Run Validate (3 steps).') : null,
            slotCard(store, 'produced', 'Produced table'),
            st.authoring.comparisonEnabled
                ? slotCard(store, 'expected', 'Expected table (comparison reference)')
                : h('div', { class: 'hint' }, 'Comparison is off — only the produced table is needed. Turn it on in ③ Comparison to add an expected table.'),
            inferenceBanner(store));
    };

    // ---------------- Schema panel (§3.1 master–detail, §5) ----------------

    function authoringResultPanel(store) {
        const v = store.state.authoring.lastValidation;
        if (!v) return null;
        // §5: error/advisory click-through navigates to the offending area
        const link = (path, cls, text) => h('div', {
            class: cls + ' clickable', title: 'click to go to this setting',
            onclick: () => store.dispatch.goToPath(path),
        }, text);
        return h('div', { class: 'card authoring' },
            h('div', { class: 'card-title' }, 'Authoring validation ',
                v.valid ? h('span', { class: 'ok' }, '✓ valid') : h('span', { class: 'bad' }, `✖ ${v.errors.length} error(s)`)),
            v.errors.map((e) => link(e.path, 'auth-err',
                `✖ ${e.path}: expected ${typeof e.expected === 'string' ? e.expected : JSON.stringify(e.expected)}, got ${JSON.stringify(e.actual)}`)),
            v.advisories.map((a) => link(a.setting, 'auth-adv', `⚠ ${a.setting} has no effect: ${a.reason}`)),
            v.deferred.length ? h('div', { class: 'auth-def' },
                `◌ deferred: ${v.deferred.join(', ')} — checkable only with a function registry. Paste the functions under Advanced mode (④ Run tab) to check and run them here, or run via the API. The config exports fine either way.`) : null);
    }

    function columnEditor(store, name) {
        const ctx = fieldCtx(store, name);
        const doc = store.state.authoring.doc;
        const def = (doc.columns || {})[name];
        if (!def) return h('div', {}, 'Column not found.');
        const typeName = def.type && def.type.name;

        const renameInput = h('input', { type: 'text', value: name, class: 'narrow' });
        const rename = () => {
            const to = renameInput.value.trim();
            if (!to || to === name) return;
            if (/[.[\]]/.test(to)) { store.dispatch.noticeAdd('error', 'Column names must not contain ".", "[" or "]" in the console (dotted-path addressing).'); return; }
            store.dispatch.mutate((d) => {
                const cols = {};
                for (const [k, v] of Object.entries(d.columns)) cols[k === name ? to : k] = v;
                d.columns = cols;
            });
            store.dispatch.selectSchema('_columns', to);
        };

        const typeSelect = h('select', {
            onchange: (e) => store.dispatch.mutate((d) => { d.columns[name].type = { name: e.target.value }; }),
        }, TYPE_NAMES.map((t) => h('option', { value: t, selected: typeName === t }, t)));

        const colFields = NS.sectionDescriptors('columns')
            .filter((d) => d.path !== 'columns.<name>.type.name')
            .map((d) => NS.field(d, ctx));
        const typeFields = typeName ? NS.sectionDescriptors('type:' + typeName).map((d) => NS.field(d, ctx)) : [];

        return h('div', { class: 'card' },
            h('div', { class: 'card-title' }, `Column: ${name} `,
                renameInput, h('button', { class: 'mini', onclick: rename }, 'rename'),
                h('button', {
                    class: 'mini danger',
                    onclick: () => store.dispatch.dialogOpen({ kind: 'confirm', title: 'Remove column', danger: true,
                        text: `Remove column "${name}" from the config?`, okLabel: 'Remove', onOk: () => store.dispatch.removeColumn(name) }),
                }, 'remove')),
            h('div', { class: 'field' }, h('label', {}, 'type.name', h('span', { class: 'req' }, ' *')), typeSelect),
            h('div', { class: 'fields' }, typeFields.length ? [h('h4', {}, `${typeName} settings`), typeFields] : null),
            h('div', { class: 'fields' }, h('h4', {}, 'column settings'), colFields),
            byRuleEditor(store, name, def, typeName));
    }

    // §5 polish: visual byRule severity editor — constrained to the rule names the
    // column can emit (Core rule 53); writes the plain-string or {default, byRule} form.
    const EMITTABLE_BY_TYPE = (typeName) => {
        const always = ['nullabilityViolation', 'uniquenessViolation', 'requiredColumnMissing', 'allNullColumn', 'duplicateColumnContent'];
        const rules = always.slice();
        if (typeName !== 'skip') rules.unshift('typeMismatch');
        if (typeName === 'categorical') rules.unshift('categoryMismatch');
        if (['string', 'int', 'float', 'decimal', 'datetime', 'date', 'time'].includes(typeName)) rules.unshift('rangeBreach');
        if (typeName === 'string') rules.unshift('regexMismatch');
        return rules;
    };

    function byRuleEditor(store, name, def, typeName) {
        const cur = def.severity;
        const curDefault = typeof cur === 'string' ? cur : (cur && cur.default) || '';
        const curByRule = (cur && typeof cur === 'object' && cur.byRule) || {};
        const rules = EMITTABLE_BY_TYPE(typeName);
        const commit = (dflt, byRule) => {
            const hasRules = Object.keys(byRule).length > 0;
            let value;
            if (!hasRules) value = dflt === '' ? undefined : dflt;
            else value = Object.assign({}, dflt === '' ? {} : { default: dflt }, { byRule });
            store.dispatch.edit(`columns.${name}.severity`, value);
        };
        const selDefault = h('select', {
            onchange: (e) => commit(e.target.value, curByRule),
        },
            h('option', { value: '', selected: curDefault === '' }, '(default: error)'),
            ['error', 'warning'].map((o) => h('option', { value: o, selected: curDefault === o }, o)));
        const row = (rule) => h('tr', {},
            h('td', {}, rule),
            h('td', {}, h('select', {
                onchange: (e) => {
                    const byRule = Object.assign({}, curByRule);
                    if (e.target.value === '') delete byRule[rule];
                    else byRule[rule] = e.target.value;
                    commit(curDefault, byRule);
                },
            },
                h('option', { value: '', selected: curByRule[rule] === undefined }, '(inherit)'),
                ['error', 'warning'].map((o) => h('option', { value: o, selected: curByRule[rule] === o }, o)))));
        return h('details', { class: 'byrule', open: Object.keys(curByRule).length ? true : undefined },
            h('summary', {}, `per-rule severity (byRule) — ${Object.keys(curByRule).length || 'no'} override(s)`),
            h('div', { class: 'hint' }, 'Rule names are constrained to what this column can emit (Core rule 53). The plain severity select above is the default; overrides here produce the {default, byRule} form.'),
            h('div', { class: 'field' }, h('label', {}, 'default'), selDefault),
            h('table', { class: 'grid' }, h('tr', {}, h('th', {}, 'rule'), h('th', {}, 'severity')), rules.map(row)));
    }

    function checksEditor(store, kind) {
        // kind: 'compositeKeys' | 'customRowChecks' | 'customTableChecks'
        const doc = store.state.authoring.doc;
        const list = Array.isArray(doc[kind]) ? doc[kind] : [];
        const cols = Object.keys(doc.columns || {});
        const ctx = fieldCtx(store);
        const remove = (i) => store.dispatch.mutate((d) => { d[kind].splice(i, 1); if (!d[kind].length) delete d[kind]; });

        // Use the meta-model's dependsOn to show only the fields the entry's `type`
        // can carry (a "requires type = X" dependency in machine form).
        const typeAdmits = (d, entryType) => {
            for (const dep of d.dependsOn || []) {
                if (dep.kind === 'requires' && dep.predicate && /\[\]\.type$/.test(dep.predicate.path || '')) {
                    if (dep.predicate.op === 'eq' && entryType !== dep.predicate.value) return false;
                    if (dep.predicate.op === 'in' && !(dep.predicate.value || []).includes(entryType)) return false;
                }
            }
            return true;
        };
        NS.typeAdmits = typeAdmits;

        const entryFields = (i) => {
            const descs = NS.sectionDescriptors(kind);
            const entryType = list[i] && list[i].type;
            return descs.filter((d) => typeAdmits(d, entryType)).map((d) => {
                const concrete = d.path.replace('[]', `[${i}]`);
                // column-name selects where the descriptor references columns
                if (/\.(fieldA|fieldB|field|expectedField)$/.test(d.path) || d.path.endsWith('[].columns') || d.path.endsWith('[].fields')) {
                    return columnRefField(store, d, concrete, cols, /columns$|fields$/.test(d.path));
                }
                return NS.field(d, ctx, concrete);
            });
        };

        const adder = {
            compositeKeys: () => store.dispatch.mutate((d) => { (d.compositeKeys = d.compositeKeys || []).push({ columns: cols.slice(0, 2) }); }),
            customRowChecks: () => store.dispatch.mutate((d) => { (d.customRowChecks = d.customRowChecks || []).push({ name: `rowCheck${list.length + 1}`, type: 'comparison' }); }),
            customTableChecks: () => store.dispatch.mutate((d) => { (d.customTableChecks = d.customTableChecks || []).push({ name: `tableCheck${list.length + 1}`, type: 'monotonic' }); }),
        }[kind];

        return h('div', { class: 'card' },
            h('div', { class: 'card-title' }, kind, ' ', h('button', { class: 'mini', onclick: adder }, '+ add')),
            list.length === 0 ? h('div', { class: 'hint' }, 'none defined') : null,
            list.map((entry, i) => h('details', { class: 'check-entry', open: true },
                h('summary', {}, `${kind}[${i}] ${entry.name || ''} `, h('button', { class: 'mini danger', onclick: (e) => { e.preventDefault(); remove(i); } }, 'remove')),
                h('div', { class: 'fields' }, entryFields(i)))));
    }

    function columnRefField(store, desc, concretePath, cols, multi) {
        const b = store.state.authoring.builder;
        const cur = b.get(concretePath);
        if (multi) {
            const boxes = cols.map((c) => {
                const cb = h('input', {
                    type: 'checkbox', checked: Array.isArray(cur) && cur.includes(c),
                    onchange: () => {
                        const now = boxes.filter((x) => x.box.checked).map((x) => x.name);
                        store.dispatch.edit(concretePath, now.length ? now : undefined);
                    },
                });
                return { name: c, box: cb, el: h('label', { class: 'inline' }, cb, c) };
            });
            return h('div', { class: 'field' },
                h('label', { title: desc.doc.description }, desc.doc.label, desc.required ? h('span', { class: 'req' }, ' *') : null),
                h('span', {}, boxes.map((x) => x.el)));
        }
        return h('div', { class: 'field' },
            h('label', { title: desc.doc.description }, desc.doc.label),
            h('select', { onchange: (e) => store.dispatch.edit(concretePath, e.target.value === '' ? undefined : e.target.value) },
                h('option', { value: '', selected: cur === undefined }, '(unset)'),
                cols.map((c) => h('option', { value: c, selected: cur === c }, c))));
    }
    NS.columnRefField = columnRefField;

    NS.SchemaPanel = function (store) {
        const st = store.state;
        const doc = st.authoring.doc;
        const cols = Object.keys(doc.columns || {});
        const sel = st.ui.schemaSel;
        const selCol = st.ui.selectedColumn;
        const ctx = fieldCtx(store);

        const addCol = () => store.dispatch.dialogOpen({
            kind: 'prompt', title: 'Add column', text: 'New column name:', okLabel: 'Add',
            onOk: (name) => {
                if (!name || !name.trim()) return;
                if (/[.[\]]/.test(name)) { store.dispatch.noticeAdd('error', 'Column names must not contain ".", "[" or "]" in the console.'); return; }
                store.dispatch.addColumn(name.trim());
            },
        });

        const master = h('div', { class: 'master' },
            h('h4', {}, 'Columns ', h('button', { class: 'mini', onclick: addCol }, '+ add')),
            cols.length === 0 ? h('div', { class: 'hint' }, 'no columns yet — add one, or infer a draft from data (① Data)') : null,
            cols.map((c, i) => h('div', { class: 'master-item' + (sel === '_columns' && selCol === c ? ' active' : '') },
                h('a', { href: '#', onclick: (e) => { e.preventDefault(); store.dispatch.selectSchema('_columns', c); } },
                    `${c} `, h('small', {}, (doc.columns[c].type && doc.columns[c].type.name) || '?')),
                h('span', { class: 'ordbtns' },
                    i > 0 ? h('button', { class: 'mini', title: 'move up (column order is semantic)', onclick: () => store.dispatch.moveColumn(c, i - 1) }, '↑') : null,
                    i < cols.length - 1 ? h('button', { class: 'mini', onclick: () => store.dispatch.moveColumn(c, i + 1) }, '↓') : null))),
            h('h4', {}, 'Table settings'),
            [['_meta', 'meta'], ['_evaluation', 'evaluation'], ['_nullHandling', 'nullHandling'],
             ['_structure', 'structure'], ['_resultConfig', 'resultConfig'],
             ['_compositeKeys', 'compositeKeys'], ['_customRowChecks', 'row checks'], ['_customTableChecks', 'table checks'],
             ['_preview', 'resolved preview']]
                .map(([key, label]) => h('div', { class: 'master-item' + (sel === key ? ' active' : '') },
                    h('a', { href: '#', onclick: (e) => { e.preventDefault(); store.dispatch.selectSchema(key); } }, label))));

        let detail;
        if (sel === '_columns' && selCol && doc.columns && doc.columns[selCol]) detail = columnEditor(store, selCol);
        else if (sel === '_preview') {
            // builder.resolvedPreview() surfaced for inspection (Addendum §A.4: authored vs resolved)
            const preview = st.authoring.preview;
            detail = h('div', { class: 'card' },
                h('div', { class: 'card-title' }, 'Fully-resolved preview ',
                    h('button', { class: 'mini', onclick: () => NS.download(`${(doc.meta && doc.meta.name) || 'config'}-resolved.json`, JSON.stringify(preview, null, 2), 'application/json') }, 'download')),
                h('div', { class: 'hint' }, 'Defaults + overrides applied (engine Phase-2 semantics) — inspection only. What you save and export stays the sparse authored form; resolution proper remains the engine\'s job (Addendum §A.5).'),
                h('pre', { class: 'preview' }, JSON.stringify(preview, null, 2)));
        }
        else if (sel === '_compositeKeys') detail = checksEditor(store, 'compositeKeys');
        else if (sel === '_customRowChecks') detail = checksEditor(store, 'customRowChecks');
        else if (sel === '_customTableChecks') detail = checksEditor(store, 'customTableChecks');
        else if (['_meta', '_evaluation', '_nullHandling', '_structure', '_resultConfig'].includes(sel)) {
            const section = sel.slice(1);
            detail = h('div', { class: 'card' },
                h('div', { class: 'card-title' }, section),
                section === 'resultConfig' ? h('div', { class: 'hint' }, 'Collection flags are auto-derived from the requested outputs at run time (never weakened) — see ④ Run.') : null,
                h('div', { class: 'fields' }, NS.sectionFields(section, ctx)));
        } else {
            detail = h('div', { class: 'card' }, h('div', { class: 'hint' }, 'Select a column or a settings group on the left. All forms render from TableValidation.configModel — the machine-readable settings catalog.'));
        }

        return h('section', { class: 'schema-layout' },
            master,
            h('div', { class: 'detail' }, detail, authoringResultPanel(store)));
    };

    // ---------------- Comparison panel (§5) ----------------

    // §15.8 ToleranceSpec editor — the four forms (absolute number | {field, from} |
    // {percent, of} | {fn}) as a form selector plus the chosen form's inputs, matching the
    // panel's compound-control convention (cf. rangeControl/smsControl) rather than raw JSON.
    // Rule C4 gates tolerance to int/float/decimal columns; the sibling `exact` flag stays
    // int/float only (a decimal column is always exact — rules 59/C4, so it carries no exact
    // editor here). Referenced columns (field, of) must be numeric per rule C5. The {fn} form
    // carries the Advanced-mode deferral hint (rule C5), matching the diff-checks pattern.
    const TOL_FORMS = [
        ['', '(none)'],
        ['absolute', 'absolute (number)'],
        ['field', 'per-row field'],
        ['percent', 'relative percent'],
        ['fn', 'custom fn'],
    ];
    function toleranceForm(v) {
        if (v === undefined || v === null) return '';
        if (typeof v === 'number') return 'absolute';
        if (v && typeof v === 'object') {
            if (v.fn !== undefined) return 'fn';
            if (v.percent !== undefined) return 'percent';
            if (v.field !== undefined) return 'field';
        }
        return '';
    }

    function toleranceCell(store, base, numericCols) {
        const path = `${base}.tolerance`;
        const cur = store.state.authoring.builder.get(path);
        const form = toleranceForm(cur);
        const edit = (v) => store.dispatch.edit(path, v);
        const numCol0 = numericCols[0] || '';

        const selector = h('select', {
            title: 'ToleranceSpec form (Core §15.8)',
            onchange: (e) => {
                switch (e.target.value) {
                    case '': edit(undefined); break;
                    case 'absolute': edit(typeof cur === 'number' ? cur : 0); break;
                    case 'field': edit({ field: (cur && cur.field) || numCol0, from: (cur && cur.from) || 'expected' }); break;
                    case 'percent': edit({ percent: (cur && typeof cur.percent === 'number') ? cur.percent : 0, of: (cur && cur.of) || numCol0 }); break;
                    case 'fn': edit({ fn: (cur && cur.fn) || '' }); break;
                }
            },
        }, TOL_FORMS.map(([v, label]) => h('option', { value: v, selected: form === v }, label)));

        const colSelect = (key) => h('select', {
            title: 'referenced column — must exist and be numeric (rule C5)',
            onchange: (e) => edit(Object.assign({}, cur, { [key]: e.target.value })),
        }, numericCols.length
            ? numericCols.map((c) => h('option', { value: c, selected: cur && cur[key] === c }, c))
            : h('option', { value: '' }, '(no numeric column)'));

        let body = null;
        if (form === 'absolute') {
            body = h('input', {
                type: 'text', class: 'narrow', value: typeof cur === 'number' ? String(cur) : '',
                placeholder: 'ε ≥ 0',
                onchange: (e) => { const t = e.target.value.trim(); edit(t === '' ? undefined : (Number.isNaN(Number(t)) ? t : Number(t))); },
            });
        } else if (form === 'field') {
            body = h('span', { class: 'inline-opts' },
                'field ', colSelect('field'), ' from ',
                h('select', {
                    title: 'from — authoritative side supplying the per-row driving value (default expected)',
                    onchange: (e) => edit(Object.assign({}, cur, { from: e.target.value })),
                }, ['expected', 'produced'].map((o) => h('option', { value: o, selected: (cur && cur.from ? cur.from : 'expected') === o }, o))));
        } else if (form === 'percent') {
            body = h('span', { class: 'inline-opts' },
                h('input', {
                    type: 'text', class: 'narrow', value: typeof (cur && cur.percent) === 'number' ? String(cur.percent) : '',
                    placeholder: '%',
                    onchange: (e) => { const t = e.target.value.trim(); edit(Object.assign({}, cur, { percent: Number.isNaN(Number(t)) ? t : Number(t) })); },
                }), '% of ', colSelect('of'));
        } else if (form === 'fn') {
            body = h('span', {},
                h('input', {
                    type: 'text', class: 'narrow', value: (cur && cur.fn) || '', placeholder: 'registered fn name',
                    onchange: (e) => edit(Object.assign({}, cur, { fn: e.target.value.trim() })),
                }),
                h('div', { class: 'hint' }, 'A custom fn needs a function registry (rule C5). Paste the functions under Advanced mode (④ Run tab) to check and run them here, or run via the API; without Advanced mode the run blocks with a stated reason. The config exports fine either way.'));
        }
        return h('div', { class: 'tol-editor' }, selector, body);
    }

    NS.ComparisonPanel = function (store) {
        const st = store.state;
        const on = st.authoring.comparisonEnabled;
        const doc = st.authoring.doc;
        const cols = Object.keys(doc.columns || {});
        const ctx = fieldCtx(store);

        const toggle = h('div', { class: 'card' },
            h('label', { class: 'big' },
                h('input', {
                    type: 'checkbox', checked: on,
                    onchange: (e) => {
                        if (!e.target.checked) {
                            e.target.checked = true;
                            store.dispatch.dialogOpen({ kind: 'confirm', title: 'Turn comparison off', danger: true,
                                text: 'Turning comparison off removes the comparison section from the config. Continue?',
                                okLabel: 'Turn off', onOk: () => store.dispatch.toggleComparison(false) });
                            return;
                        }
                        store.dispatch.toggleComparison(e.target.checked);
                    },
                }), ' Comparison enabled'),
            h('div', { class: 'hint' }, 'The toggle IS the artifact fact: on = the config carries a `comparison` section; off = validation-only (first-class). One config artifact serves both engines (UI arch §2.1/§2.2).'));

        if (!on) return h('section', {}, toggle);

        const b = st.authoring.builder;
        const keyField = NS.columnRefField(store, NS.descriptor('comparison.match.keys'), 'comparison.match.keys', cols, true);

        const fuzzyOn = b.get('comparison.match.fuzzy') !== undefined;
        const fuzzyToggle = h('label', { class: 'inline' },
            h('input', {
                type: 'checkbox', checked: fuzzyOn,
                onchange: (e) => {
                    if (e.target.checked) store.dispatch.edit('comparison.match.fuzzy', { components: cols.slice(0, 1), threshold: 0.9 });
                    else store.dispatch.edit('comparison.match.fuzzy', undefined);
                },
            }), 'fuzzy key pairing');
        const fuzzyFields = fuzzyOn ? [
            NS.columnRefField(store, NS.descriptor('comparison.match.fuzzy.components'), 'comparison.match.fuzzy.components', cols, true),
            NS.field(NS.descriptor('comparison.match.fuzzy.threshold'), ctx),
            NS.field(NS.descriptor('comparison.match.fuzzy.metric'), ctx),
            NS.field(NS.descriptor('comparison.match.fuzzy.ambiguityMargin'), ctx),
            NS.field(NS.descriptor('comparison.match.fuzzy.maxCandidatePairs'), ctx),
        ] : [];

        const matchCard = h('div', { class: 'card' },
            h('div', { class: 'card-title' }, 'Match'),
            h('div', { class: 'fields' },
                keyField,
                NS.field(NS.descriptor('comparison.match.setMode'), ctx),
                NS.field(NS.descriptor('comparison.match.onDuplicateKey'), ctx),
                h('div', { class: 'field' }, h('label', {}, 'fuzzy'), fuzzyToggle),
                fuzzyFields));

        // per-field table (compare / presence / expectedName / tolerance / fuzzy) — §15.3 fields
        const typeOf = (c) => (doc.columns[c].type && doc.columns[c].type.name) || '?';
        const numericCols = cols.filter((c) => ['int', 'float', 'decimal'].includes(typeOf(c)));
        const fieldsCard = h('div', { class: 'card' },
            h('div', { class: 'card-title' }, 'Per-column comparison options'),
            h('table', { class: 'grid' },
                h('tr', {}, ['column', 'type', 'compare', 'presence', 'expected header (alias)', 'tolerance (§15.8)', 'fuzzy threshold (string cols)'].map((c) => h('th', {}, c))),
                cols.map((c) => {
                    const base = `comparison.fields.${c}`;
                    const get = (p) => b.get(p);
                    const numeric = ['int', 'float', 'decimal'].includes(typeOf(c));
                    const isStr = typeOf(c) === 'string';
                    return h('tr', {},
                        h('td', {}, c), h('td', {}, typeOf(c)),
                        h('td', {}, h('select', { onchange: (e) => store.dispatch.edit(`${base}.compare`, e.target.value === '' ? undefined : e.target.value === 'true') },
                            h('option', { value: '', selected: get(`${base}.compare`) === undefined }, '(default: true)'),
                            h('option', { value: 'true', selected: get(`${base}.compare`) === true }, 'true'),
                            h('option', { value: 'false', selected: get(`${base}.compare`) === false }, 'false'))),
                        h('td', {}, h('select', { onchange: (e) => store.dispatch.edit(`${base}.presence`, e.target.value === '' ? undefined : e.target.value) },
                            h('option', { value: '', selected: get(`${base}.presence`) === undefined }, '(default: both)'),
                            ['both', 'producedOnly', 'expectedOnly'].map((o) => h('option', { value: o, selected: get(`${base}.presence`) === o }, o)))),
                        h('td', {}, h('input', {
                            type: 'text', class: 'narrow',
                            value: get(`${base}.expectedName`) === undefined || get(`${base}.expectedName`) === null ? '' : get(`${base}.expectedName`),
                            placeholder: '(same header)',
                            title: 'Header the EXPECTED table carries this column under; results keep the logical name (byName matching only)',
                            onchange: (e) => {
                                const t = e.target.value;
                                store.dispatch.edit(`${base}.expectedName`, t === '' ? undefined : t);
                            },
                        })),
                        h('td', {}, numeric ? toleranceCell(store, base, numericCols) : h('span', { class: 'hint' }, 'numeric only')),
                        h('td', {}, isStr ? h('input', {
                            type: 'text', class: 'narrow', value: get(`${base}.fuzzy`) ? String(get(`${base}.fuzzy`).threshold) : '',
                            placeholder: 'e.g. 0.88',
                            onchange: (e) => {
                                const t = e.target.value.trim();
                                store.dispatch.edit(`${base}.fuzzy`, t === '' ? undefined : { threshold: Number(t) });
                            },
                        }) : h('span', { class: 'hint' }, 'string only')));
                })));

        // rowMissing/rowUnexpected defaults derive from setMode (Core §15.12) — show the
        // ACTUAL effective default as the placeholder, not the static descriptor default
        const setMode = (st.authoring.preview.comparison && st.authoring.preview.comparison.match &&
            st.authoring.preview.comparison.match.setMode) || 'exact';
        const sevDesc = (d) => {
            if (d.path === 'comparison.severity.rowMissing') {
                return Object.assign({}, d, { default: setMode === 'subset' ? 'none' : 'error' });
            }
            if (d.path === 'comparison.severity.rowUnexpected') {
                return Object.assign({}, d, { default: setMode === 'superset' ? 'none' : 'error' });
            }
            return d;
        };
        const sevCard = h('div', { class: 'card' },
            h('div', { class: 'card-title' }, 'Severity map (outcome tier → none | warning | error)'),
            h('div', { class: 'hint' }, `Policy only: mapping a tier to "none" silences its severity, never the fact — differences always stay visible in the diff (Core §15.2). rowMissing/rowUnexpected defaults derive from setMode (currently "${setMode}").`),
            h('div', { class: 'fields' },
                NS.sectionDescriptors('comparison')
                    .filter((d) => d.path.startsWith('comparison.severity.'))
                    .map((d) => NS.field(sevDesc(d), ctx))));

        const scopeOn = b.get('comparison.scope') !== undefined;
        const scopeCard = h('div', { class: 'card' },
            h('div', { class: 'card-title' }, 'Scope (filter indicator — never a severity lever)'),
            h('label', { class: 'inline' }, h('input', {
                type: 'checkbox', checked: scopeOn,
                onchange: (e) => store.dispatch.edit('comparison.scope', e.target.checked ? { column: cols[0] || '', inScopeValues: [] } : undefined),
            }), 'scope enabled'),
            scopeOn ? h('div', { class: 'fields' },
                NS.columnRefField(store, NS.descriptor('comparison.scope.column'), 'comparison.scope.column', cols, false),
                NS.field(NS.descriptor('comparison.scope.inScopeValues'), ctx),
                NS.field(NS.descriptor('comparison.scope.outOfScopeValues'), ctx),
                NS.field(NS.descriptor('comparison.scope.matchStrategy'), ctx),
                NS.field(NS.descriptor('comparison.scope.outOfScopePolicy'), ctx)) : null);

        const diffChecksCard = h('div', { class: 'card' },
            h('div', { class: 'card-title' }, 'Diff checks (row + table level)'),
            ['row', 'table'].map((level) => {
                const arr = (b.get('comparison.diffChecks') || {})[level] || [];
                return h('div', {},
                    h('h4', {}, `${level}-level `, h('button', {
                        class: 'mini',
                        onclick: () => store.dispatch.mutate((d) => {
                            const dc = d.comparison.diffChecks = d.comparison.diffChecks || {};
                            (dc[level] = dc[level] || []).push(level === 'row'
                                ? { name: `rowDiff${arr.length + 1}`, type: 'custom', fn: '' }
                                : { name: `tableDiff${arr.length + 1}`, type: 'mismatchRateMax', params: { max: 0.01 } });
                        }),
                    }, '+ add')),
                    arr.map((chk, i) => h('div', { class: 'fields check-entry' },
                        NS.sectionDescriptors('comparison')
                            .filter((d) => d.path.startsWith(`comparison.diffChecks.${level}[]`))
                            .filter((d) => !NS.typeAdmits || NS.typeAdmits(d, chk && chk.type))
                            .map((d) => NS.field(d, ctx, d.path.replace('[]', `[${i}]`))),
                        h('button', { class: 'mini danger', onclick: () => store.dispatch.mutate((d) => { d.comparison.diffChecks[level].splice(i, 1); }) }, 'remove'))));
            }),
            h('div', { class: 'hint' }, 'type "custom" needs a function registry (rule C8). Paste the functions under Advanced mode (④ Run tab) to check and run them here, or run via the API; without Advanced mode the run blocks with a stated reason. The config exports fine either way.'));

        return h('section', {}, toggle, matchCard, fieldsCard, sevCard, scopeCard, diffChecksCard, authoringResultPanel(store));
    };
})(globalThis);
