/* Table Validation — Node conformance runner (official Node support, JS profile).
 *
 * Executes the SAME vector corpus as the browser suite (test/index.html) in plain
 * Node ≥ 20 — no npm project, no toolchain. The vectors and the library are plain
 * <script>-style files, so they are executed in this context with `vm`, with
 * `window` aliased to `globalThis` (the library itself only ever reads globalThis).
 *
 * Dependencies: Luxon and ExcelJS are consumer-installed in real Node use. This
 * runner has no package.json, so it fetches the same browser bundles the HTML
 * harness uses from jsDelivr and caches them under the OS temp dir; offline, the
 * dependent vectors report as BLOCKED (never silently skipped), like the browser
 * harness does.
 *
 * Usage: node test/node-runner.js            (exit 0 = all pass; 1 = failures; 2 = blocked only)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PIN = '2026-07-08T12:00:00Z';

const CDN_DEPS = [
    { global: 'luxon', url: 'https://cdn.jsdelivr.net/npm/luxon@3/build/global/luxon.min.js', cacheAs: 'luxon.min.js' },
    { global: 'ExcelJS', url: 'https://cdn.jsdelivr.net/npm/exceljs@4/dist/exceljs.min.js', cacheAs: 'exceljs.min.js' },
];

const VECTOR_FILES = [
    'vectors/schema-phase.js', 'vectors/structural.js', 'vectors/cell.js',
    'vectors/parser-negatives.js', 'vectors/aggregate.js', 'vectors/row-checks.js',
    'vectors/table-checks.js', 'vectors/breakers.js', 'vectors/temporal.js',
    'vectors/comparison.js', 'vectors/unit.js',
    'vectors/authoring.js', 'vectors/ingest.js', 'vectors/infer.js',
    'vectors/quality.js', 'vectors/corpus.js', 'vectors/fuzz.js', 'vectors/mutation.js',
    'vectors/console-compiler.js',
];

// Console modules the vectors reach into. console/ui.js is a globalThis IIFE that is
// DOM-free at load time (it only touches `document` inside functions the headless tests
// never call), so its pure helpers (e.g. compileNumberExample) are exercisable here.
const CONSOLE_FILES = ['console/ui.js'];

// ---------------- environment ----------------

function runFile(file) {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInThisContext(code, { filename: file });
}

async function loadCdnDeps() {
    const cacheDir = path.join(os.tmpdir(), 'table-validation-node-deps');
    fs.mkdirSync(cacheDir, { recursive: true });
    for (const dep of CDN_DEPS) {
        const cached = path.join(cacheDir, dep.cacheAs);
        if (!fs.existsSync(cached)) {
            try {
                const res = await fetch(dep.url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                fs.writeFileSync(cached, await res.text());
            } catch (e) {
                console.error(`# could not fetch ${dep.global} (${e.message}) — dependent vectors will be BLOCKED`);
                continue;
            }
        }
        try { runFile(cached); } catch (e) {
            console.error(`# ${dep.global} bundle failed to evaluate in Node: ${e.message}`);
        }
    }
}

// ---------------- harness (mirrors test/runner.js semantics) ----------------

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

function partialMatch(exp, act, p, errs) {
    if (exp === null || typeof exp !== 'object') {
        if (exp !== act) errs.push(`${p}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`);
        return;
    }
    if (Array.isArray(exp)) {
        if (!Array.isArray(act)) { errs.push(`${p}: expected array, got ${JSON.stringify(act)}`); return; }
        if (exp.length !== act.length) { errs.push(`${p}: expected array length ${exp.length}, got ${act.length}`); return; }
        exp.forEach((e, i) => partialMatch(e, act[i], `${p}[${i}]`, errs));
        return;
    }
    if (act === null || typeof act !== 'object' || Array.isArray(act)) {
        errs.push(`${p}: expected object, got ${JSON.stringify(act)}`);
        return;
    }
    for (const k of Object.keys(exp)) partialMatch(exp[k], act[k], `${p}.${k}`, errs);
}

const results = [];
const report = (suite, name, status, notes) => results.push({ suite, name, status, notes: notes || [] });

function runVectorOnce(TableValidation, v, referenceInstant, expect, label) {
    const errs = [];
    const options = Object.assign({}, v.options || {});
    if (v.functions) options.functions = v.functions;
    if (options.referenceInstant === undefined) options.referenceInstant = referenceInstant;
    deepFreeze(v.schema); deepFreeze(v.table); deepFreeze(options);
    if (v.throws) {
        try {
            TableValidation.validate(v.schema, v.table, options);
            errs.push(`expected ${v.throws} to be thrown, but validate returned`);
        } catch (e) {
            if (!e || e.name !== v.throws) errs.push(`expected ${v.throws}, got: ${e && (e.name + ': ' + e.message)}`);
        }
        return errs;
    }
    let r1, r2;
    try {
        r1 = TableValidation.validate(v.schema, v.table, options);
        r2 = TableValidation.validate(v.schema, v.table, options);
    } catch (e) {
        errs.push(`threw unexpectedly${label ? ' (' + label + ')' : ''}: ${e && (e.name + ': ' + e.message)}`);
        return errs;
    }
    if (!deepEqual(r1, r2)) errs.push('determinism: two identical runs produced different results');
    if (r1.specVersion !== TableValidation.SPEC_VERSION) errs.push(`specVersion: got ${r1.specVersion}`);
    partialMatch(expect, r1, label ? `result(${label})` : 'result', errs);
    return errs;
}

async function main() {
    globalThis.window = globalThis;
    globalThis.__VECTORS__ = [];
    globalThis.__UNIT__ = [];
    window.__VECTORS__ = globalThis.__VECTORS__;
    window.__UNIT__ = globalThis.__UNIT__;

    await loadCdnDeps();
    runFile(path.join(ROOT, 'dist', 'table-validation.js'));
    const TV = globalThis.TableValidation;
    if (!TV) { console.error('TableValidation global missing'); process.exit(1); }
    for (const f of CONSOLE_FILES) runFile(path.join(ROOT, f));
    for (const f of VECTOR_FILES) runFile(path.join(ROOT, 'test', f));

    for (const v of globalThis.__VECTORS__) {
        if (v.needsLuxon && !globalThis.luxon) { report(v.suite, v.name, 'blocked', ['Luxon unavailable']); continue; }
        let errs = [];
        try {
            if (v.runs) {
                for (const run of v.runs) {
                    errs = errs.concat(runVectorOnce(TV, v, run.referenceInstant, run.expect, `@${run.referenceInstant}`));
                }
            } else {
                errs = runVectorOnce(TV, v, PIN, v.expect, '');
            }
        } catch (e) { errs.push(`harness error: ${e && e.message}`); }
        report(v.suite, v.name, errs.length ? 'fail' : 'pass', errs);
    }

    for (const u of globalThis.__UNIT__) {
        if (u.needsLuxon && !globalThis.luxon) { report(u.suite, u.name, 'blocked', ['Luxon unavailable']); continue; }
        if (u.needsExcelJS && !globalThis.ExcelJS) { report(u.suite, u.name, 'blocked', ['ExcelJS unavailable']); continue; }
        const errs = [];
        const assert = (cond, msg) => { if (!cond) errs.push(msg); };
        const assertEq = (act, exp, msg) => {
            if (!deepEqual(act, exp)) errs.push(`${msg}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`);
        };
        const assertThrows = (fn, name, msg) => {
            try { fn(); errs.push(`${msg}: expected ${name} to be thrown`); }
            catch (e) { if (!e || e.name !== name) errs.push(`${msg}: expected ${name}, got ${e && e.name}: ${e && e.message}`); }
        };
        try {
            await u.fn({ assert, assertEq, assertThrows, partial: (exp, act, msg) => partialMatch(exp, act, msg, errs), PIN });
        } catch (e) { errs.push(`threw unexpectedly: ${e && (e.name + ': ' + e.message)}${e && e.stack ? '\n' + e.stack : ''}`); }
        report(u.suite, u.name, errs.length ? 'fail' : 'pass', errs);
    }

    // ---- d.ts consistency: every exported member appears in the declaration file
    (function dtsCheck() {
        const errs = [];
        const dtsPath = path.join(ROOT, 'dist', 'table-validation.d.ts');
        if (!fs.existsSync(dtsPath)) errs.push('dist/table-validation.d.ts is missing');
        else {
            const dts = fs.readFileSync(dtsPath, 'utf8');
            for (const key of Object.keys(TV)) {
                const re = new RegExp(`(function|const|class|namespace)\\s+${key}\\b`);
                if (!re.test(dts)) errs.push(`exported member "${key}" not declared in table-validation.d.ts`);
            }
            for (const key of Object.keys(TV.adapters)) {
                if (!new RegExp(`function\\s+${key}\\b`).test(dts)) errs.push(`adapters.${key} not declared`);
            }
            if (!dts.includes(TV.VERSION)) errs.push(`d.ts does not mention the release version ${TV.VERSION}`);
        }
        report('node', 'd.ts declares the full public surface', errs.length ? 'fail' : 'pass', errs);
    })();

    // ---- docs-as-tests (WS6 item 4): §12/§15.12 defaults vs configModel; §8 examples verbatim
    try {
        const docs = require('./docs-tests.js');
        if (docs.coreSpecPath()) {
            const dd = docs.checkDefaultsTables(TV);
            report('docs', `Core §12/§15.12 defaults tables match configModel (${dd.checked} rows)`, dd.errs.length ? 'fail' : 'pass', dd.errs);
            const sr = docs.checkSettingsReference(TV);
            report('docs', `Core §11 Settings Reference required/enum match configModel (${sr.checkedRequired} required, ${sr.checkedEnum} enum)`,
                sr.errs.length ? 'fail' : 'pass', sr.errs);
        } else {
            // the Core Spec lives in the table-validation-spec repository — blocked, never silently skipped
            report('docs', 'Core §12/§15.12 defaults tables match configModel', 'blocked',
                ['core spec not found: drop a copy in the repo root, set $TV_SPEC_DIR, or clone table-validation-spec as a sibling']);
            report('docs', 'Core §11 Settings Reference required/enum match configModel', 'blocked',
                ['core spec not found: drop a copy in the repo root, set $TV_SPEC_DIR, or clone table-validation-spec as a sibling']);
        }
        if (globalThis.luxon && globalThis.ExcelJS) {
            const ue = await docs.runUsageExamples(TV);
            report('docs', `JS profile §8 usage examples execute verbatim (${ue.blocks} blocks)`, ue.errs.length ? 'fail' : 'pass', ue.errs);
        } else {
            report('docs', 'JS profile §8 usage examples', 'blocked', ['Luxon/ExcelJS unavailable']);
        }
    } catch (e) {
        report('docs', 'docs-as-tests harness', 'fail', [String(e && e.stack || e)]);
    }

    // ---- summary
    const counts = { pass: 0, fail: 0, blocked: 0 };
    for (const r of results) counts[r.status]++;
    let suite = null;
    for (const r of results) {
        if (r.status === 'pass') continue;
        if (r.suite !== suite) { suite = r.suite; console.log(`\n## ${suite}`); }
        console.log(` ${r.status === 'fail' ? 'FAIL' : 'BLOCKED'}: ${r.name}`);
        for (const n of r.notes) console.log(`   - ${n}`);
    }
    console.log(`\n${counts.fail === 0 ? 'OK' : 'FAILED'}: ${counts.pass} passed, ${counts.fail} failed, ` +
        `${counts.blocked} blocked - ${results.length} total (Node ${process.version}, TableValidation v${TV.VERSION})`);
    process.exit(counts.fail ? 1 : (counts.blocked ? 2 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
