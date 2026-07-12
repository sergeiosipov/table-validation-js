/*!
 * table-validation-worker v1.2.0 — classic Web Worker wrapper for the table-validation
 * engine (Browser JS profile). Hand-authored vanilla ES2020; no build step; CDN-fetchable
 * from the same tag as dist/table-validation.js.
 * License: MIT.
 */
/*
 * Load with:  new Worker('<same dir as the engine>/table-validation-worker.js')
 * The worker imports './table-validation.js' from its own directory at startup.
 *
 * MESSAGE PROTOCOL (JS profile §3.14). Every request is
 *     { id: any, op: string, args: any[] }
 * and yields exactly one response,
 *     { id, ok: true, result }                             on success
 *   | { id, ok: false, error: { name, message, code, detail } }   on failure.
 *
 * Ops:
 *   'init'        args: [scriptUrls: string[]]  — importScripts additional dependency
 *                 bundles (Luxon, ExcelJS) into the worker. Run once before temporal/XLSX
 *                 work. result: { imported: string[] }
 *   'validate'    args: [schema, table, options?]           → ValidationResult
 *   'compare'     args: [schema, produced, expected, options?] → ComparisonResult
 *   'ingest'      args: [source, ingestSpec, options?]      → IngestResult
 *   'inferConfig' args: [table, options?]                    → InferenceResult
 *   'ping'        args: []                                   → { version }
 *
 * Structured-clone safety: results are sanitized before posting — any non-plain object
 * (e.g. a Luxon DateTime carried as an interpreted value in cellObservations or diff
 * cells) is rendered to its ISO string (via .toISO()) or String(...) fallback. Plain
 * data is passed through unchanged, so results are byte-identical to the main-thread
 * engines except for those interpreted temporal objects.
 *
 * Limitation (by design): `options.functions` / `options.normalizationFunctions` cannot
 * cross the postMessage boundary (functions are not structured-clone-able). Configs
 * needing host functions must run on a thread that owns the registry — the engines'
 * behavior there is unchanged.
 */
'use strict';
/* eslint-env worker */
importScripts('table-validation.js');

(function () {
    const TV = self.TableValidation;

    function sanitize(v) {
        if (v === null || typeof v !== 'object') {
            return typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint' ? String(v) : v;
        }
        if (Array.isArray(v)) return v.map(sanitize);
        const proto = Object.getPrototypeOf(v);
        if (proto === Object.prototype || proto === null) {
            const o = {};
            for (const k of Object.keys(v)) o[k] = sanitize(v[k]);
            return o;
        }
        if (v instanceof Blob) return v;                        // clonable as-is
        if (typeof v.toISO === 'function') return v.toISO();    // Luxon DateTime and friends
        if (v instanceof Date) return v.toISOString();
        return String(v);
    }

    function fail(id, e) {
        self.postMessage({
            id, ok: false,
            error: {
                name: (e && e.name) || 'Error',
                message: (e && e.message) || String(e),
                code: e && e.code !== undefined ? e.code : null,
                detail: e && e.detail !== undefined ? sanitize(e.detail) : null,
            },
        });
    }

    self.onmessage = async (ev) => {
        const msg = ev.data || {};
        const { id, op } = msg;
        const args = Array.isArray(msg.args) ? msg.args : [];
        try {
            let result;
            if (op === 'ping') {
                result = { version: TV.VERSION };
            } else if (op === 'init') {
                const urls = Array.isArray(args[0]) ? args[0] : [];
                for (const u of urls) importScripts(u);
                result = { imported: urls };
            } else if (op === 'validate') {
                result = sanitize(TV.validate(args[0], args[1], args[2]));
            } else if (op === 'compare') {
                result = sanitize(TV.compare(args[0], args[1], args[2], args[3]));
            } else if (op === 'ingest') {
                result = sanitize(await TV.ingest(args[0], args[1], args[2]));
            } else if (op === 'inferConfig') {
                result = sanitize(TV.inferConfig(args[0], args[1]));
            } else {
                throw new TV.TableValidationConfigError(`unknown worker op "${op}"`);
            }
            self.postMessage({ id, ok: true, result });
        } catch (e) {
            fail(id, e);
        }
    };
})();
