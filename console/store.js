/* Authoring & Run Console — store, actions, persistence, derivations.
 * Implements the state model of table-validation-ui-architecture-v1.0.0.md §4 and §7.
 * Vanilla ES2020 IIFE; one console namespace global (TVConsole). No framework. */
'use strict';
(function (global) {
    const NS = global.TVConsole = global.TVConsole || {};
    const TV = () => global.TableValidation;

    const LS_LIBRARY = 'tvconsole.v1.library';
    const LS_SESSION = 'tvconsole.v1.session';

    // ---------------- helpers ----------------

    const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    const uid = () => 'cfg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    function lsGet(key) {
        try {
            const raw = global.localStorage.getItem(key);
            if (!raw) return null;
            const v = JSON.parse(raw);
            return v && v.formatVersion === 1 ? v : null;      // §7: versioned envelope, clean fallback
        } catch (_) { return null; }
    }
    function lsSet(key, value) {
        try { global.localStorage.setItem(key, JSON.stringify(Object.assign({ formatVersion: 1 }, value))); return true; }
        catch (_) { return false; }                             // quota/private mode → in-memory only (§7)
    }

    const emptySlot = () => ({
        status: 'empty',            // empty | picked | ingesting | ready | failed
        file: null,                 // File handle while picked (not persisted)
        pastedText: null,           // pasted source string (§11: string sources subsume the adapters)
        fileMeta: null,             // { name, sizeBytes } — persisted re-upload stub (§2.3)
        form: null,                 // IngestSpec form values while picked
        table: null, provenance: null, warnings: [], normalizationActions: null,
        error: null,                // { code, message, detail }
        stub: null,                 // persisted provenance of a previous session's upload
    });

    // ---------------- initial state (§4.1) ----------------

    function initialState() {
        return {
            configs: { entries: [], activeId: null },
            authoring: {
                builder: null,               // opaque ConfigBuilder — source of truth for the draft
                history: { past: [], future: [] },   // bounded undo/redo over build() snapshots
                lastValidation: null,        // AuthoringValidationResult (Addendum §A.4), verbatim
                doc: null,                   // builder.build() snapshot (render convenience)
                preview: null,               // builder.resolvedPreview() snapshot (relevance eval)
                comparisonEnabled: false,
                dirtySinceSave: false,
            },
            data: { produced: emptySlot(), expected: emptySlot() },
            // §9 advanced mode: per-session custom-function registry. Sources are NEVER
            // persisted (localStorage untouched), never exported, and the mode is off
            // after every reload — the security posture is deliberate.
            advanced: { enabled: false, sources: [] },   // sources: [{ name, src }]
            inference: { status: 'idle', offer: null, options: { sampleRows: 1000, suggestRanges: false, suggestPrecision: true, seedComparison: false, allAcceptingFormats: false, exhaustive: false } },
            run: {
                status: 'idle', mode: null, viaWorker: false,
                previous: null,          // last completed run { result, report, mode } — feeds the Δ view
                messageTemplates: '',    // §3.5 template-override map as JSON text ('' = none)
                requestedOutputs: { errorsView: true, xlsxReport: false, annotatedXlsx: false },
                referenceInstant: '',        // dev determinism affordance (§8); '' = now
                effectiveResultConfig: null,
                runConfig: null,             // config snapshot the engine actually saw (exports use it, §6)
                result: null, report: null, stale: false, error: null,
            },
            ui: {
                activeTab: 'data',           // data | schema | comparison | run
                resultView: 'report',
                filters: { severity: '', ruleName: '', column: '', scope: '', matchStatus: '' },
                schemaSel: '_columns',       // selected schema-panel item: column name or _section key
                selectedColumn: null,
                notices: [],                 // [{ kind: 'info'|'warn'|'error', text }]
                dialog: null,                // inline dialog (replaces prompt/confirm/alert):
                                             //   { kind, title, text, value, danger, okLabel, onOk }
                persistFailed: false,
                dataTint: 'auto',            // data-view tinting: auto | severity | outcome (§6 legend toggle)
                flashCell: null,             // { row, field } — errors-row → data-view cross-navigation (§6)
                sort: null,                  // { view, key, dir } — user sort; null = §6 default sort
            },
        };
    }

    // ---------------- builder wrappers ----------------

    // §9 advanced mode: compile the pasted sources with the Function constructor —
    // ONLY when the user explicitly enabled the mode this session. Each source must
    // evaluate to a function expression.
    function compileAdvanced(st) {
        const fns = {};
        const errors = [];
        if (!st.advanced.enabled) return { fns, errors, count: 0 };
        for (const src of st.advanced.sources) {
            const name = (src.name || '').trim();
            if (!name || !(src.src || '').trim()) continue;
            try {
                const f = new Function('"use strict"; return (' + src.src + ');')();
                if (typeof f !== 'function') throw new Error('the source must evaluate to a function expression');
                fns[name] = f;
            } catch (e) { errors.push({ name, message: e.message }); }
        }
        return { fns, errors, count: Object.keys(fns).length };
    }
    NS.compileAdvanced = compileAdvanced;

    function refreshAuthoring(st) {
        const a = st.authoring;
        a.doc = a.builder.build();
        a.comparisonEnabled = a.doc.comparison !== undefined;
        try { a.preview = a.builder.resolvedPreview(); } catch (_) { a.preview = a.doc; }
        // with advanced mode on, rule 30 is checked against the session registry
        // (a missing function becomes a real authoring error instead of a deferral)
        const adv = compileAdvanced(st);
        try { a.lastValidation = a.builder.validate(adv.count ? { functions: adv.fns } : undefined); }
        catch (e) { a.lastValidation = { valid: false, errors: [{ path: '(builder)', expected: 'validatable config', actual: String(e && e.message) }], advisories: [], deferred: [] }; }
    }

    function loadBuilder(st, configJson, activeId) {
        st.authoring.builder = TV().createConfigBuilder(configJson || undefined);
        st.configs.activeId = activeId !== undefined ? activeId : null;
        st.authoring.dirtySinceSave = false;
        st.authoring.history = { past: [], future: [] };
        refreshAuthoring(st);
        markStale(st);
    }

    // bounded undo/redo (§5 polish): snapshot the authored doc before each edit
    const UNDO_CAP = 30;
    function snapshot(st) {
        const hst = st.authoring.history;
        hst.past.push(JSON.stringify(st.authoring.builder.build()));
        if (hst.past.length > UNDO_CAP) hst.past.shift();
        hst.future.length = 0;
    }
    function restoreDoc(st, json) {
        st.authoring.builder = TV().createConfigBuilder(JSON.parse(json));
        st.authoring.dirtySinceSave = true;
        refreshAuthoring(st);
        markStale(st);
    }

    function markStale(st) { if (st.run.result) st.run.stale = true; }

    // Structural edits with no per-path API (delete a check, rename a column):
    // rebuild the builder from a mutated authored snapshot (§5 note).
    function mutateDoc(st, fn) {
        snapshot(st);
        const doc = st.authoring.builder.build();
        fn(doc);
        st.authoring.builder = TV().createConfigBuilder(doc);
        st.authoring.dirtySinceSave = true;
        refreshAuthoring(st);
        markStale(st);
    }

    // ---------------- readiness (§4.2) ----------------

    function readiness(st) {
        const a = st.authoring;
        const v = a.lastValidation;
        const authoringReady = !!(v && v.valid);
        // §9 custom-function guardrail: without a registry, any deferred rule would become
        // a guaranteed schemaInvalid abort at run time. Advanced mode (Run tab) supplies a
        // per-session registry, turning the deferral into a real checkable rule.
        const deferredBlock = !!(v && v.deferred && v.deferred.length > 0);
        const reasons = { validate: [], compare: [] };
        if (!authoringReady) { reasons.validate.push('the config has authoring errors (Schema tab)'); }
        if (deferredBlock) {
            reasons.validate.push('the config references custom functions (deferred: ' + v.deferred.join(', ') + ') — paste them under Advanced mode on the Run tab, run via the API, or remove the custom checks');
        }
        if (st.data.produced.status !== 'ready') reasons.validate.push('no produced table ingested (Data tab)');
        reasons.compare = reasons.validate.slice();
        if (!a.comparisonEnabled) reasons.compare.push('comparison is off (Comparison tab)');
        else if (st.data.expected.status !== 'ready') reasons.compare.push('no expected table ingested (Data tab)');
        return {
            authoringReady, deferredBlock,
            canValidate: reasons.validate.length === 0,
            canCompare: reasons.compare.length === 0,
            reasons,
        };
    }

    // ---------------- collection-flag derivation (§4.3) ----------------

    function deriveFlags(st, mode) {
        const out = st.run.requestedOutputs;
        const rc = (st.authoring.doc && st.authoring.doc.resultConfig) || {};
        const needRegister = [];
        if (out.errorsView) needRegister.push('Errors view');
        if (out.xlsxReport) needRegister.push('XLSX report');
        const needObs = [];
        if (out.annotatedXlsx && mode !== 'compare') needObs.push('Annotated XLSX');
        return {
            collectCellRegister: { value: rc.collectCellRegister === true || needRegister.length > 0, authored: rc.collectCellRegister === true, neededBy: needRegister },
            collectCellObservations: { value: rc.collectCellObservations === true || needObs.length > 0, authored: rc.collectCellObservations === true, neededBy: needObs },
        };
    }

    // §3.5 template overrides: parse the Run-panel JSON map (strings only)
    function parseTemplates(st) {
        const t = (st.run.messageTemplates || '').trim();
        if (!t) return { map: null };
        let map;
        try { map = JSON.parse(t); } catch (e) { return { error: 'messageTemplates is not valid JSON: ' + e.message }; }
        if (map === null || typeof map !== 'object' || Array.isArray(map)) return { error: 'messageTemplates must be a JSON object map' };
        for (const [k, v] of Object.entries(map)) {
            if (typeof v !== 'string') return { error: `messageTemplates.${k} must be a string template` };
        }
        return { map: Object.keys(map).length ? map : null };
    }
    NS.parseTemplates = parseTemplates;

    // ---------------- persistence (§7) ----------------

    function persistLibrary(st) {
        if (!lsSet(LS_LIBRARY, { entries: st.configs.entries })) st.ui.persistFailed = true;
    }
    function persistSession(st) {
        const stubOf = (slot) => slot.fileMeta ? { fileMeta: slot.fileMeta, provenance: slot.provenance } : (slot.stub || null);
        if (!lsSet(LS_SESSION, {
            activeConfigId: st.configs.activeId,
            activeTab: st.ui.activeTab,
            requestedOutputs: st.run.requestedOutputs,
            messageTemplates: st.run.messageTemplates,
            dataStubs: { produced: stubOf(st.data.produced), expected: stubOf(st.data.expected) },
        })) st.ui.persistFailed = true;
    }

    function boot(st) {
        const lib = lsGet(LS_LIBRARY);
        if (lib && Array.isArray(lib.entries)) st.configs.entries = lib.entries;
        const ses = lsGet(LS_SESSION);
        if (ses) {
            if (ses.requestedOutputs) Object.assign(st.run.requestedOutputs, ses.requestedOutputs);
            if (typeof ses.messageTemplates === 'string') st.run.messageTemplates = ses.messageTemplates;
            if (ses.activeTab) st.ui.activeTab = ses.activeTab;
            if (ses.dataStubs) {
                if (ses.dataStubs.produced) st.data.produced.stub = ses.dataStubs.produced;
                if (ses.dataStubs.expected) st.data.expected.stub = ses.dataStubs.expected;
            }
            const entry = ses.activeConfigId && st.configs.entries.find((e) => e.id === ses.activeConfigId);
            if (entry) { loadBuilder(st, entry.config, entry.id); return; }
        }
        loadBuilder(st, undefined, null);
    }

    // ---------------- ingest form → IngestSpec ----------------

    function suggestFormat(name) {
        const ext = (name.match(/\.([^.]+)$/) || [])[1];
        return { csv: 'csv', tsv: 'tsv', txt: 'csv', xlsx: 'xlsx', json: 'jsonArrays' }[(ext || '').toLowerCase()] || 'csv';
    }

    function defaultForm(file) {
        return {
            format: suggestFormat(file.name),
            headerMode: 'firstRow', headerNames: '',
            delimiter: ',', quote: '"', encoding: 'auto',
            sheet: '0', skipRows: '0', skipFooterRows: '0', limits: '',
            // §B.8 normalization editor state: step lists edited structurally
            // (fn picker + params JSON), converted to a NormalizationSpec on Ingest
            norm: { table: [], columns: [] },   // columns: [{ key, steps: [{ fn, params }] }]
        };
    }

    function buildNormSteps(steps) {
        return steps.map((s) => {
            const out = { fn: s.fn };
            if (s.params && s.params.trim()) out.params = JSON.parse(s.params);
            return out;
        });
    }

    function buildIngestSpec(form) {
        const spec = { format: form.format };
        if (form.format !== 'jsonObjects') {
            spec.header = { mode: form.headerMode };
            if (form.headerMode === 'explicit') spec.header.names = JSON.parse(form.headerNames || '[]');
        }
        if (form.format === 'csv') spec.csv = { delimiter: form.delimiter, quote: form.quote, encoding: form.encoding };
        if (form.format === 'tsv') spec.csv = { quote: form.quote, encoding: form.encoding };
        if (form.format === 'xlsx') spec.xlsx = { sheet: /^\d+$/.test(form.sheet.trim()) ? parseInt(form.sheet, 10) : form.sheet };
        for (const k of ['skipRows', 'skipFooterRows']) {
            const v = (form[k] || '').trim();
            if (v !== '' && v !== '0') spec[k] = /^\d+$/.test(v) ? parseInt(v, 10) : v;   // non-int passes through → I13 error surfaces
        }
        if (form.limits && form.limits.trim()) spec.limits = JSON.parse(form.limits);
        const nm = form.norm || { table: [], columns: [] };
        if (nm.table.length || nm.columns.length) {
            const normalization = {};
            if (nm.table.length) normalization.table = buildNormSteps(nm.table);
            if (nm.columns.length) {
                normalization.columns = {};
                for (const c of nm.columns) normalization.columns[c.key] = buildNormSteps(c.steps);
            }
            spec.normalization = normalization;
        }
        return spec;
    }

    // ---------------- engine worker (§8) ----------------
    // Engines run in a Web Worker when the console is served over http(s) — workers
    // are unavailable from file:// pages, where the main-thread fallback keeps the
    // console fully functional. Custom-function registries cannot cross the worker
    // boundary (not structured-clone-able), so runs needing one stay on the main thread.

    const WORKER_DEP_URLS = [
        'https://cdn.jsdelivr.net/npm/luxon@3/build/global/luxon.min.js',
        'https://cdn.jsdelivr.net/npm/exceljs@4/dist/exceljs.min.js',
    ];
    let workerRef = null;
    let workerBroken = false;
    let workerReqId = 0;
    const workerPending = new Map();

    function workerCall(op, args) {
        const id = ++workerReqId;
        return new Promise((resolve, reject) => {
            workerPending.set(id, { resolve, reject });
            workerRef.postMessage({ id, op, args });
        });
    }

    function getEngineWorker() {
        if (workerBroken) return null;
        if (typeof global.Worker === 'undefined' || !/^https?:$/.test(global.location.protocol)) return null;
        if (!workerRef) {
            try {
                workerRef = new global.Worker('dist/table-validation-worker.js');
                workerRef.onmessage = (ev) => {
                    const m = ev.data || {};
                    const p = workerPending.get(m.id);
                    if (!p) return;
                    workerPending.delete(m.id);
                    if (m.ok) p.resolve(m.result);
                    else {
                        const e = new Error(m.error.message);
                        e.name = m.error.name; e.code = m.error.code; e.detail = m.error.detail;
                        p.reject(e);
                    }
                };
                workerRef.onerror = () => {
                    workerBroken = true;
                    for (const p of workerPending.values()) p.reject(new Error('engine worker failed'));
                    workerPending.clear();
                    workerRef = null;
                };
                workerCall('init', [WORKER_DEP_URLS]).catch(() => { /* deps optional; ops fail lazily */ });
            } catch (_) { workerBroken = true; workerRef = null; return null; }
        }
        return workerRef ? { call: workerCall } : null;
    }

    // ---------------- store ----------------

    function createStore(render) {
        const st = initialState();
        let scheduled = false;
        const notify = () => {
            if (scheduled) return;
            scheduled = true;
            Promise.resolve().then(() => { scheduled = false; render(st); });
        };

        const notice = (kind, text) => {
            st.ui.notices.push({ kind, text });
            if (st.ui.notices.length > 6) st.ui.notices.splice(0, st.ui.notices.length - 6);
        };

        const actions = {
            // ---- ui
            setTab(tab) { st.ui.activeTab = tab; persistSession(st); },
            setResultView(v) { st.ui.resultView = v; if (v !== 'data') st.ui.flashCell = null; },
            setFilter(k, v) { st.ui.filters[k] = v; },
            setDataTint(v) { st.ui.dataTint = v; },
            // §6 "Sortable": clicking a header cycles asc → desc → default
            toggleSort(view, key) {
                const s = st.ui.sort;
                if (!s || s.view !== view || s.key !== key) st.ui.sort = { view, key, dir: 1 };
                else if (s.dir === 1) st.ui.sort = { view, key, dir: -1 };
                else st.ui.sort = null;
            },
            // §6: Errors-row click cross-navigates to the Data view cell
            flashCell(row, field) { st.ui.flashCell = { row, field }; st.ui.resultView = 'data'; },
            // §5 AuthoringResultPanel click-through: focus the area the error path points at
            goToPath(path) {
                const seg = String(path).split(/[.[]/)[0];
                if (seg === 'columns') {
                    const col = String(path).split('.')[1];
                    st.ui.activeTab = 'schema';
                    st.ui.schemaSel = '_columns';
                    st.ui.selectedColumn = (st.authoring.doc.columns && col in st.authoring.doc.columns) ? col : null;
                } else if (seg === 'comparison') {
                    st.ui.activeTab = 'comparison';
                } else {
                    st.ui.activeTab = 'schema';
                    st.ui.schemaSel = ['meta', 'evaluation', 'nullHandling', 'structure', 'resultConfig',
                        'compositeKeys', 'customRowChecks', 'customTableChecks'].includes(seg) ? '_' + seg : '_columns';
                }
                persistSession(st);
            },
            dismissNotice(i) { st.ui.notices.splice(i, 1); },
            noticeAdd(kind, text) { notice(kind, text); },
            selectSchema(sel, col) { st.ui.schemaSel = sel; st.ui.selectedColumn = col !== undefined ? col : null; },

            // ---- config library (§2.1, D1: one artifact kind, many named entries)
            configNew() { loadBuilder(st, undefined, null); notice('info', 'New config started (unsaved).'); },
            configLoad(id) {
                const e = st.configs.entries.find((x) => x.id === id);
                if (!e) return;
                loadBuilder(st, e.config, id);
            },
            configSave() {
                const cfg = st.authoring.builder.build();
                const name = (cfg.meta && cfg.meta.name) || 'untitled';
                let e = st.configs.entries.find((x) => x.id === st.configs.activeId);
                if (!e) { e = { id: uid(), name, updatedAt: '', config: cfg }; st.configs.entries.push(e); st.configs.activeId = e.id; }
                e.name = name;
                e.config = cfg;
                e.updatedAt = new Date().toISOString();
                st.authoring.dirtySinceSave = false;
                persistLibrary(st); persistSession(st);
                notice('info', `Saved "${name}".`);
            },
            // §2.1: duplicate action — reuse across datasets via the library
            configDuplicate() {
                const cfg = st.authoring.builder.build();
                cfg.meta = Object.assign({}, cfg.meta, { name: ((cfg.meta && cfg.meta.name) || 'untitled') + ' (copy)' });
                const e = { id: uid(), name: cfg.meta.name, updatedAt: new Date().toISOString(), config: cfg };
                st.configs.entries.push(e);
                loadBuilder(st, e.config, e.id);
                persistLibrary(st); persistSession(st);
                notice('info', `Duplicated as "${e.name}".`);
            },
            configDelete(id) {
                st.configs.entries = st.configs.entries.filter((x) => x.id !== id);
                if (st.configs.activeId === id) st.configs.activeId = null;
                persistLibrary(st); persistSession(st);
            },
            configImport(text, fileName) {
                let json;
                try { json = JSON.parse(text); } catch (_) { notice('error', `Import failed: ${fileName} is not valid JSON.`); return; }
                if (json === null || typeof json !== 'object' || Array.isArray(json)) { notice('error', 'Import failed: a config must be a JSON object.'); return; }
                const e = { id: uid(), name: (json.meta && json.meta.name) || fileName, updatedAt: new Date().toISOString(), config: json };
                st.configs.entries.push(e);
                loadBuilder(st, e.config, e.id);
                persistLibrary(st); persistSession(st);
                notice('info', `Imported "${e.name}" — authoring validation ran; see the Schema tab.`);
            },
            // "Copy section from…" (§2.1) — the UI-level answer to comparison-policy reuse
            copySectionFrom(sourceId, section) {
                const e = st.configs.entries.find((x) => x.id === sourceId);
                if (!e || e.config[section] === undefined) { notice('warn', 'Nothing to copy: the source config has no such section.'); return; }
                mutateDoc(st, (doc) => { doc[section] = clone(e.config[section]); });
                notice('info', `Copied "${section}" from "${e.name}".`);
            },

            // ---- schema editing (all through the builder)
            edit(path, value) {
                snapshot(st);
                try {
                    if (value === undefined) st.authoring.builder.unset(path);
                    else st.authoring.builder.set(path, value);
                } catch (e) { st.authoring.history.past.pop(); notice('error', `Edit rejected: ${e.message}`); return; }
                st.authoring.dirtySinceSave = true;
                refreshAuthoring(st);
                markStale(st);
            },
            mutate(fn) { mutateDoc(st, fn); },
            addColumn(name, def) {
                snapshot(st);
                try { st.authoring.builder.addColumn(name, def || { type: { name: 'string' } }); }
                catch (e) { st.authoring.history.past.pop(); notice('error', e.message); return; }
                st.authoring.dirtySinceSave = true;
                st.ui.schemaSel = '_columns'; st.ui.selectedColumn = name;
                refreshAuthoring(st); markStale(st);
            },
            removeColumn(name) {
                snapshot(st);
                try { st.authoring.builder.removeColumn(name); }
                catch (e) { st.authoring.history.past.pop(); notice('error', e.message); return; }
                if (st.ui.selectedColumn === name) st.ui.selectedColumn = null;
                st.authoring.dirtySinceSave = true;
                refreshAuthoring(st); markStale(st);
            },
            moveColumn(name, toIndex) {
                snapshot(st);
                try { st.authoring.builder.moveColumn(name, toIndex); }
                catch (e) { st.authoring.history.past.pop(); notice('error', e.message); return; }
                st.authoring.dirtySinceSave = true;
                refreshAuthoring(st); markStale(st);
            },
            toggleComparison(on) {
                snapshot(st);
                if (on) {
                    if (!st.authoring.comparisonEnabled) {
                        const cols = Object.keys(st.authoring.doc.columns || {});
                        st.authoring.builder.setComparison({ match: { keys: cols.length ? [cols[0]] : [] } });
                    }
                } else {
                    st.authoring.builder.setComparison(null);
                    st.data.expected = emptySlot();                     // §2.2: OFF hides the expected slot
                }
                st.authoring.dirtySinceSave = true;
                refreshAuthoring(st); markStale(st); persistSession(st);
            },

            // ---- data (§2.3)
            // §11 paste-data source: the pasted string IS the ingest source (JS profile
            // §3.12 string row — CSV/TSV text or JSON; subsumes the §3.9 adapters)
            pasteText(slotName, text) {
                const slot = st.data[slotName];
                slot.status = 'picked';
                slot.file = null;
                slot.pastedText = text;
                slot.fileMeta = { name: '(pasted)', sizeBytes: text.length };
                const trimmed = text.trimStart();
                const fmt = trimmed.startsWith('[') || trimmed.startsWith('{')
                    ? (trimmed.replace(/^\[\s*/, '').startsWith('{') ? 'jsonObjects' : 'jsonArrays')
                    : (text.includes('\t') ? 'tsv' : 'csv');
                slot.form = Object.assign(defaultForm({ name: '(pasted)' }), { format: fmt });
                slot.error = null; slot.stub = null;
                notify();
            },
            pickFile(slotName, file) {
                const slot = st.data[slotName];
                slot.status = 'picked';
                slot.file = file;
                slot.pastedText = null;
                slot.fileMeta = { name: file.name, sizeBytes: file.size };
                // an imported workspace carries the previous IngestSpec form — restore it
                slot.form = slot.stub && slot.stub.form ? clone(slot.stub.form) : defaultForm(file);
                slot.error = null; slot.stub = null;
                notify();
            },
            setIngestForm(slotName, key, value) { st.data[slotName].form[key] = value; },
            // §B.8 normalization editor: structural edits on the form's step lists
            mutateIngestForm(slotName, fn) { fn(st.data[slotName].form); },
            clearSlot(slotName) { st.data[slotName] = emptySlot(); markStale(st); persistSession(st); },
            async ingest(slotName) {
                const slot = st.data[slotName];
                if ((!slot.file && slot.pastedText === null) || !slot.form) return;
                let spec;
                try { spec = buildIngestSpec(slot.form); }
                catch (e) { slot.error = { code: 'ingestSpecInvalid', message: 'Form field is not valid JSON: ' + e.message, detail: null }; notify(); return; }
                slot.status = 'ingesting';
                notify();
                try {
                    const source = slot.pastedText !== null
                        ? slot.pastedText
                        : ((spec.format === 'jsonArrays' || spec.format === 'jsonObjects')
                            ? await slot.file.text() : slot.file);
                    const r = await TV().ingest(source, spec);
                    slot.status = 'ready';
                    slot.table = r.table;
                    slot.provenance = r.source;
                    slot.warnings = r.warnings;
                    slot.normalizationActions = r.normalizationActions !== undefined ? r.normalizationActions : null;
                    slot.error = null;
                    if (slotName === 'produced') { st.inference.status = 'idle'; st.inference.offer = null; }
                    markStale(st);
                    persistSession(st);
                } catch (e) {
                    slot.status = 'failed';
                    slot.table = null; slot.provenance = null; slot.warnings = []; slot.normalizationActions = null;
                    slot.error = { code: e.code || null, message: e.message, detail: e.detail || null, name: e.name };
                }
                notify();
            },

            // ---- inference (§2.3: always explicit, never auto-applied)
            setInferOption(k, v) { st.inference.options[k] = v; },
            inferRun() {
                const t = st.data.produced.table;
                if (!t) return;
                try {
                    const o = st.inference.options;
                    st.inference.offer = TV().inferConfig(t, {
                        name: (st.authoring.doc.meta && st.authoring.doc.meta.name) || 'inferred-config',
                        sampleRows: o.sampleRows, suggestRanges: o.suggestRanges, suggestPrecision: o.suggestPrecision,
                        seedComparison: o.seedComparison, allAcceptingFormats: o.allAcceptingFormats, exhaustive: o.exhaustive,
                    });
                    st.inference.status = 'offered';
                } catch (e) { notice('error', 'Inference failed: ' + e.message); }
            },
            inferAccept() {
                if (!st.inference.offer) return;
                loadBuilder(st, st.inference.offer.draft, null);
                st.inference.status = 'idle';
                notice('info', 'Draft config loaded into the builder — review it on the Schema tab; it is a suggestion, never authoritative.');
                st.ui.activeTab = 'schema';
                persistSession(st);
            },
            inferDismiss() { st.inference.status = 'dismissed'; },

            // ---- advanced mode (§9): per-session custom functions, explicit opt-in
            advancedSetEnabled(on) {
                st.advanced.enabled = !!on;
                if (on && st.advanced.sources.length === 0) st.advanced.sources.push({ name: '', src: '' });
                refreshAuthoring(st); markStale(st);
            },
            advancedAdd() { st.advanced.sources.push({ name: '', src: '' }); },
            advancedEdit(i, key, value) {
                if (!st.advanced.sources[i]) return;
                st.advanced.sources[i][key] = value;
                refreshAuthoring(st); markStale(st);
            },
            advancedRemove(i) {
                st.advanced.sources.splice(i, 1);
                refreshAuthoring(st); markStale(st);
            },

            // ---- inline dialogs (§5 polish; replaces prompt/confirm/alert)
            dialogOpen(spec) { st.ui.dialog = Object.assign({ value: '' }, spec); },
            dialogSetValue(v) { if (st.ui.dialog) st.ui.dialog.value = v; },
            dialogOk() {
                const d = st.ui.dialog;
                st.ui.dialog = null;
                if (d && d.onOk) d.onOk(d.kind === 'prompt' ? d.value : true);
            },
            dialogCancel() { st.ui.dialog = null; },

            // ---- undo/redo (§5 polish): bounded builder snapshots
            undo() {
                const hst = st.authoring.history;
                if (!hst.past.length) return;
                hst.future.push(JSON.stringify(st.authoring.builder.build()));
                restoreDoc(st, hst.past.pop());
            },
            redo() {
                const hst = st.authoring.history;
                if (!hst.future.length) return;
                hst.past.push(JSON.stringify(st.authoring.builder.build()));
                restoreDoc(st, hst.future.pop());
            },

            // ---- workspace export/import (§2.3): one JSON bundle — config, ingest specs,
            // data-slot provenance stubs (NOT the data), outputs, referenceInstant
            workspaceExportJson() {
                const stubOf = (slot) => slot.fileMeta
                    ? { fileMeta: slot.fileMeta, provenance: slot.provenance }
                    : (slot.stub ? { fileMeta: slot.stub.fileMeta, provenance: slot.stub.provenance } : null);
                return JSON.stringify({
                    tvconsoleWorkspace: 1,
                    config: st.authoring.builder.build(),
                    configName: (st.authoring.doc.meta && st.authoring.doc.meta.name) || 'untitled',
                    ingestForms: { produced: st.data.produced.form, expected: st.data.expected.form },
                    dataStubs: { produced: stubOf(st.data.produced), expected: stubOf(st.data.expected) },
                    requestedOutputs: st.run.requestedOutputs,
                    referenceInstant: st.run.referenceInstant,
                }, null, 2);
            },
            workspaceImport(text, fileName) {
                let ws;
                try { ws = JSON.parse(text); } catch (_) { notice('error', `Workspace import failed: ${fileName} is not valid JSON.`); return; }
                const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
                if (!isPlain(ws) || ws.tvconsoleWorkspace !== 1) {
                    notice('error', 'Not a console workspace bundle (missing tvconsoleWorkspace marker).');
                    return;
                }
                const e = { id: uid(), name: ws.configName || 'imported workspace', updatedAt: new Date().toISOString(), config: ws.config || {} };
                st.configs.entries.push(e);
                loadBuilder(st, e.config, e.id);
                for (const slotName of ['produced', 'expected']) {
                    const stub = ws.dataStubs && ws.dataStubs[slotName];
                    const form = ws.ingestForms && ws.ingestForms[slotName];
                    st.data[slotName] = emptySlot();
                    if (stub || form) st.data[slotName].stub = { fileMeta: stub && stub.fileMeta, provenance: stub && stub.provenance, form: form || null };
                }
                if (isPlain(ws.requestedOutputs)) Object.assign(st.run.requestedOutputs, ws.requestedOutputs);
                if (typeof ws.referenceInstant === 'string') st.run.referenceInstant = ws.referenceInstant;
                persistLibrary(st); persistSession(st);
                notice('info', 'Workspace imported — re-upload the data file(s) shown on the Data tab, then press Run.');
            },

            // ---- run (§4.3: flags derived, authored artifact untouched)
            setOutput(k, v) { st.run.requestedOutputs[k] = v; persistSession(st); },
            setReferenceInstant(v) { st.run.referenceInstant = v; },
            // §3.5 localization seam: a JSON map { ruleName: "template with {placeholders}" };
            // string templates only in the UI (function templates are API-only)
            setMessageTemplates(v) { st.run.messageTemplates = v; persistSession(st); },
            async run(mode) {
                const r = readiness(st);
                if (mode === 'validate' ? !r.canValidate : !r.canCompare) return;
                const flags = deriveFlags(st, mode);
                const runConfig = clone(st.authoring.doc);
                runConfig.resultConfig = Object.assign({}, runConfig.resultConfig, {
                    collectCellRegister: flags.collectCellRegister.value,
                    collectCellObservations: flags.collectCellObservations.value,
                });
                st.run.status = 'running'; st.run.error = null;
                notify();
                try {
                    const opts = {};
                    if (st.run.referenceInstant.trim()) opts.referenceInstant = st.run.referenceInstant.trim();
                    const tpl = parseTemplates(st);
                    if (tpl.error) { st.run.status = 'failed'; st.run.error = { name: 'messageTemplates', message: tpl.error }; return; }
                    if (tpl.map) opts.messageTemplates = tpl.map;
                    // advanced-mode registry (functions cannot cross the worker boundary,
                    // so registry runs stay on the main thread — JS profile §3.14)
                    const adv = compileAdvanced(st);
                    if (adv.count) opts.functions = adv.fns;
                    // §8: run through the engine worker over http(s); main thread from file://
                    const w = adv.count ? null : getEngineWorker();
                    let result;
                    if (w) {
                        result = await w.call(mode,
                            mode === 'validate'
                                ? [runConfig, st.data.produced.table, opts]
                                : [runConfig, st.data.produced.table, st.data.expected.table, opts]);
                    } else {
                        result = mode === 'validate'
                            ? TV().validate(runConfig, st.data.produced.table, opts)
                            : TV().compare(runConfig, st.data.produced.table, st.data.expected.table, opts);
                    }
                    // keep the previous completed run for the Δ (run-to-run) view
                    if (st.run.result) st.run.previous = { result: st.run.result, report: st.run.report, mode: st.run.mode };
                    st.run.status = 'done';
                    st.run.mode = mode;
                    st.run.viaWorker = !!w;
                    st.run.result = result;
                    st.run.report = TV().buildReport(result);
                    st.run.runConfig = runConfig;
                    st.run.effectiveResultConfig = runConfig.resultConfig;
                    st.run.stale = false;
                    // the iterate loop: after a re-run of the same mode, land on the Δ view
                    st.ui.resultView = st.run.previous && st.run.previous.mode === mode ? 'delta' : 'report';
                    st.ui.activeTab = 'run';
                } catch (e) {
                    st.run.status = 'failed';
                    st.run.error = { message: e.message, name: e.name };
                }
            },
        };

        // every action ends in a re-render
        const dispatch = {};
        for (const [k, fn] of Object.entries(actions)) {
            dispatch[k] = (...args) => {
                const out = fn(...args);
                if (out && typeof out.then === 'function') out.then(notify, notify);
                notify();
                return out;
            };
        }

        boot(st);
        // §7 polish: multi-tab sync — the `storage` event fires in OTHER tabs when
        // localStorage changes; refresh the library (and note it) without clobbering
        // the local unsaved draft.
        if (global.addEventListener) {
            global.addEventListener('storage', (ev) => {
                if (ev.key === LS_LIBRARY) {
                    const lib = lsGet(LS_LIBRARY);
                    if (lib && Array.isArray(lib.entries)) {
                        st.configs.entries = lib.entries;
                        notice('info', 'Config library updated in another tab.');
                        notify();
                    }
                }
            });
        }
        return { state: st, dispatch, readiness: () => readiness(st), deriveFlags: (mode) => deriveFlags(st, mode) };
    }

    NS.createStore = createStore;
})(globalThis);
