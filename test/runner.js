/* Table Validation — browser conformance runner (no node; open index.html). */
'use strict';
(function () {

    const PIN = '2026-07-08T12:00:00Z';   // pinned reference instant for all vectors

    // ---------------- helpers ----------------

    function deepFreeze(o) {
        if (o === null) return o;
        const t = typeof o;
        if (t === 'object' || t === 'function') {
            Object.freeze(o);
            for (const k of Object.getOwnPropertyNames(o)) {
                try { deepFreeze(o[k]); } catch (_) { /* frozen getters etc. */ }
            }
        }
        return o;
    }

    function deepEqual(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (a === null || b === null || typeof a !== 'object') return false;
        const aa = Array.isArray(a), ab = Array.isArray(b);
        if (aa !== ab) return false;
        if (aa) {
            if (a.length !== b.length) return false;
            return a.every((v, i) => deepEqual(v, b[i]));
        }
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        return ka.every((k) => deepEqual(a[k], b[k]));
    }

    // Partial structural match: every key present in `exp` must match `act`.
    // Arrays must have the SAME length and match element-wise (each element partially).
    function partialMatch(exp, act, path, errs) {
        if (exp === null || typeof exp !== 'object') {
            if (exp !== act) errs.push(`${path}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`);
            return;
        }
        if (Array.isArray(exp)) {
            if (!Array.isArray(act)) { errs.push(`${path}: expected array, got ${JSON.stringify(act)}`); return; }
            if (exp.length !== act.length) {
                errs.push(`${path}: expected array length ${exp.length}, got ${act.length}`);
                return;
            }
            exp.forEach((e, i) => partialMatch(e, act[i], `${path}[${i}]`, errs));
            return;
        }
        if (act === null || typeof act !== 'object' || Array.isArray(act)) {
            errs.push(`${path}: expected object, got ${JSON.stringify(act)}`);
            return;
        }
        for (const k of Object.keys(exp)) partialMatch(exp[k], act[k], `${path}.${k}`, errs);
    }

    // ---------------- reporting ----------------

    const results = [];
    function report(suite, name, status, notes) {
        results.push({ suite, name, status, notes: notes || [] });
    }

    function render() {
        const counts = { pass: 0, fail: 0, blocked: 0 };
        for (const r of results) counts[r.status]++;
        const el = document.getElementById('summary');
        const ok = counts.fail === 0;
        el.className = ok ? 'ok' : 'bad';
        el.textContent = `${ok ? '✔' : '✖'} ${counts.pass} passed, ${counts.fail} failed, ` +
            `${counts.blocked} blocked — ${results.length} total ` +
            `(TableValidation v${window.TableValidation ? TableValidation.VERSION : '?'} / spec ` +
            `${window.TableValidation ? TableValidation.SPEC_VERSION : '?'})`;
        const out = document.getElementById('results');
        let suite = null;
        for (const r of results) {
            if (r.suite !== suite) {
                suite = r.suite;
                const h = document.createElement('h2');
                h.textContent = suite;
                out.appendChild(h);
            }
            const div = document.createElement('div');
            div.className = 'test ' + r.status;
            const mark = r.status === 'pass' ? '✔' : r.status === 'blocked' ? '◌' : '✖';
            div.textContent = `${mark} ${r.name}`;
            out.appendChild(div);
            for (const n of r.notes) {
                const nd = document.createElement('div');
                nd.className = 'note';
                nd.textContent = n;
                out.appendChild(nd);
            }
        }
    }

    // ---------------- vector execution ----------------

    function runVectorOnce(v, referenceInstant, expect, label) {
        const errs = [];
        const options = Object.assign({}, v.options || {});
        if (v.functions) options.functions = v.functions;
        if (options.referenceInstant === undefined) options.referenceInstant = referenceInstant;

        // purity harness: deep-freeze all inputs (strict mode → mutation throws)
        deepFreeze(v.schema);
        deepFreeze(v.table);
        deepFreeze(options);

        if (v.throws) {
            try {
                TableValidation.validate(v.schema, v.table, options);
                errs.push(`expected ${v.throws} to be thrown, but validate returned`);
            } catch (e) {
                if (!e || e.name !== v.throws) {
                    errs.push(`expected ${v.throws}, got: ${e && (e.name + ': ' + e.message)}`);
                }
            }
            return errs;
        }

        let r1, r2;
        try {
            r1 = TableValidation.validate(v.schema, v.table, options);
            r2 = TableValidation.validate(v.schema, v.table, options);   // determinism harness
        } catch (e) {
            errs.push(`threw unexpectedly${label ? ' (' + label + ')' : ''}: ` +
                `${e && (e.name + ': ' + e.message)}${e && e.stack ? '\n' + e.stack : ''}`);
            return errs;
        }
        if (!deepEqual(r1, r2)) errs.push('determinism: two identical runs produced different results');
        if (r1.specVersion !== TableValidation.SPEC_VERSION) errs.push(`specVersion: expected "${TableValidation.SPEC_VERSION}", got ${r1.specVersion}`);
        partialMatch(expect, r1, label ? `result(${label})` : 'result', errs);
        return errs;
    }

    function runVector(v) {
        if (v.needsLuxon && !window.luxon) {
            report(v.suite, v.name, 'blocked', ['Luxon global missing (CDN unreachable?) — vector not run']);
            return;
        }
        let errs = [];
        try {
            if (v.runs) {
                for (const run of v.runs) {
                    errs = errs.concat(runVectorOnce(v, run.referenceInstant, run.expect,
                        `@${run.referenceInstant}`));
                }
            } else {
                errs = runVectorOnce(v, PIN, v.expect, '');
            }
        } catch (e) {
            errs.push(`harness error: ${e && e.message}${e && e.stack ? '\n' + e.stack : ''}`);
        }
        report(v.suite, v.name, errs.length ? 'fail' : 'pass', errs);
    }

    // ---------------- unit-test execution ----------------

    async function runUnit(u) {
        if (u.needsLuxon && !window.luxon) { report(u.suite, u.name, 'blocked', ['Luxon missing']); return; }
        if (u.needsExcelJS && !window.ExcelJS) { report(u.suite, u.name, 'blocked', ['ExcelJS missing']); return; }
        const errs = [];
        const assert = (cond, msg) => { if (!cond) errs.push(msg); };
        const assertEq = (act, exp, msg) => {
            if (!deepEqual(act, exp)) {
                errs.push(`${msg}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`);
            }
        };
        const assertThrows = (fn, name, msg) => {
            try { fn(); errs.push(`${msg}: expected ${name} to be thrown`); }
            catch (e) { if (!e || e.name !== name) errs.push(`${msg}: expected ${name}, got ${e && e.name}: ${e && e.message}`); }
        };
        try {
            await u.fn({ assert, assertEq, assertThrows, partial: (exp, act, msg) => partialMatch(exp, act, msg, errs), PIN });
        } catch (e) {
            errs.push(`threw unexpectedly: ${e && (e.name + ': ' + e.message)}${e && e.stack ? '\n' + e.stack : ''}`);
        }
        report(u.suite, u.name, errs.length ? 'fail' : 'pass', errs);
    }

    // ---------------- main ----------------

    async function main() {
        if (!window.TableValidation) {
            report('bootstrap', 'library loaded', 'fail', ['TableValidation global missing — dist/table-validation.js failed to load or parse']);
            render();
            return;
        }
        report('bootstrap', 'library loaded', 'pass');
        if (!window.luxon) {
            report('bootstrap', 'luxon loaded (CDN)', 'blocked',
                ['Luxon is unavailable; temporal vectors will be reported as blocked, not skipped silently']);
        } else {
            report('bootstrap', 'luxon loaded (CDN)', 'pass');
        }
        for (const v of (window.__VECTORS__ || [])) runVector(v);
        for (const u of (window.__UNIT__ || [])) await runUnit(u);
        render();
    }

    window.addEventListener('load', () => { main(); });
})();
