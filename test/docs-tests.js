/* Quality program — docs-as-tests (WS6 item 4). Executed by test/node-runner.js
 * (needs the filesystem, so it cannot run from the file:// browser page).
 *
 * 1. The Core Spec §12 defaults table and the §15.12 comparison defaults table are
 *    PARSED FROM THE MARKDOWN and diffed against `configModel` (rule M2, checked
 *    mechanically — the doc and the descriptor cannot drift silently).
 * 2. The JS profile §8 usage examples are extracted VERBATIM and executed.
 *
 * The Core Spec lives in the separate `table-validation-spec` repository. Check 1
 * therefore resolves the spec document via `coreSpecPath()`: this repo root (if a
 * copy is dropped in), then $TV_SPEC_DIR, then a `../table-validation-spec` sibling
 * checkout. When none has it, node-runner reports the check as BLOCKED — never
 * silently skipped. Check 2 uses the in-repo JS profile and always runs.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CORE_SPEC = 'table-validation-core-spec-v1.3.2.md';

function coreSpecPath() {
    const candidates = [ROOT, process.env.TV_SPEC_DIR, path.join(ROOT, '..', 'table-validation-spec')];
    for (const dir of candidates) {
        if (dir && fs.existsSync(path.join(dir, CORE_SPEC))) return path.join(dir, CORE_SPEC);
    }
    return null;
}

// ---- §12 path → configModel path/section mapping --------------------------------

const TYPE_SECTIONS = ['string', 'int', 'float', 'bool', 'datetime', 'date', 'time', 'categorical', 'skip'];

function mapDocPath(docPath) {
    // `<type>.<key>` rows (e.g. bool.trueValues) → the type-block descriptor
    const m = /^([a-z]+)\.(.+)$/.exec(docPath);
    if (m && TYPE_SECTIONS.includes(m[1])) {
        return { path: `columns.<name>.type.${m[2]}`, section: `type:${m[1]}` };
    }
    return { path: docPath, section: null };
}

// quasi-JSON from the doc table (`{min:0, max:null, ...}` has unquoted keys)
function parseDocValue(raw) {
    let t = raw.trim();
    t = t.replace(/\s*\((?:→|->|all structural rules|effective only under[^)]*|.*?derives.*?)\)?\s*$/u, (mm) => mm.includes('{') ? mm : '');
    t = t.replace(/`/g, '');
    t = t.replace(/\\\|/g, '|');
    // strip trailing prose parentheticals: `null (→ effective: ...)`, `"error"` (all ...)
    const par = t.indexOf(' (');
    if (par !== -1) t = t.slice(0, par);
    t = t.trim();
    if (t === 'derived from setMode') return { skip: true };
    try { return { value: JSON.parse(t) }; } catch (_) { /* fall through */ }
    try { return { value: JSON.parse(t.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')) }; } catch (_) { /* */ }
    return { unparsed: t };
}

function checkDefaultsTables(TV) {
    const errs = [];
    const specPath = coreSpecPath();
    if (!specPath) throw new Error('core spec not found (repo root, $TV_SPEC_DIR, or ../table-validation-spec)');
    const core = fs.readFileSync(specPath, 'utf8');
    const model = new Map();
    for (const s of TV.configModel.settings) {
        model.set(s.path + '|' + s.section, s);
        if (!model.has(s.path)) model.set(s.path, s);
    }
    const lookup = (p, sec) => model.get(sec ? p + '|' + sec : p) || model.get(p);

    // rows the mapping deliberately cannot check — each with the reason (no silent caps)
    const EXPECTED_UNMAPPED = new Set([
        'compositeKeys', 'customRowChecks', 'customTableChecks',        // section arrays, not settings
        'structure.severities.<structuralRule>',                        // per-rule key set (rule 55), model uses <rule>
        'structure.severities.duplicateColumnName',                     // the one per-rule default exception
        'comparison.fields',                                            // section object, not a setting
        'comparison.diffChecks.row', 'comparison.diffChecks.table',     // section arrays
        'comparison.diffChecks[].severity',                             // model splits into row[]/table[].severity
    ]);

    const unmapped = [];
    let checked = 0;

    const tableRows = (md) => {
        const rows = [];
        for (const line of md.split('\n')) {
            if (!line.startsWith('|')) continue;
            const PIPE = String.fromCharCode(1);
            const cells = line.split('\\|').join(PIPE).split('|')
                .map((c) => c.split(PIPE).join('|').trim());
            if (cells.length < 4) continue;                               // | path | type | default |
            const pm = /^`([^`]+)`/.exec(cells[1]);
            if (!pm) continue;
            rows.push({ path: pm[1], rest: cells[cells.length - 2] });
        }
        return rows;
    };

    // §12 table sits between "## 12. Defaults Reference" and "## 13."
    const sec12 = core.split('## 12. Defaults Reference')[1].split('\n## 13.')[0];
    // §15.12 defaults table: after "**Defaults** (applied during schema resolution"
    const sec1512 = core.split('**Defaults** (applied during schema resolution')[1].split('Required (no default):')[0];

    for (const { source, rows } of [{ source: '§12', rows: tableRows(sec12) }, { source: '§15.12', rows: tableRows(sec1512) }]) {
        for (const row of rows) {
            const docDefault = row.rest;
            const parsed = parseDocValue(docDefault);
            if (parsed.skip) continue;                       // "derived from setMode" rows
            // object-part rows like structure.fieldNameMatching.caseSensitive → compare the part
            let target = mapDocPath(row.path);
            let part = null;
            let desc = lookup(target.path, target.section);
            if (!desc) {
                const pm = /^(.*)\.([A-Za-z]+)$/.exec(target.path);
                if (pm) {
                    const parent = lookup(pm[1], target.section);
                    if (parent && parent.default !== undefined && parent.default !== null && typeof parent.default === 'object') {
                        desc = parent; part = pm[2];
                    }
                }
            }
            if (!desc) { unmapped.push(row.path); continue; }
            if (parsed.unparsed !== undefined) { errs.push(`${source} ${row.path}: default cell not parseable: ${parsed.unparsed}`); continue; }
            const expected = part === null ? parsed.value : parsed.value;
            const actual = part === null ? desc.default : desc.default[part];
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                errs.push(`${source} ${row.path}: doc default ${JSON.stringify(expected)} ≠ configModel default ${JSON.stringify(actual)}`);
            }
            checked++;
        }
    }
    for (const u of unmapped) {
        if (!EXPECTED_UNMAPPED.has(u)) errs.push(`defaults row has no configModel mapping: ${u}`);
    }
    if (checked < 80) errs.push(`only ${checked} defaults rows checked — the table parser is likely broken`);
    return { errs, checked };
}

// ---- §11 Settings Reference: enum + required byte-match configModel (B129, A.1 M2) ------
//
// checkDefaultsTables above only diffs the `default` cell of the §12/§15.12 tables. This
// walks §11 ("Settings Reference") instead, extracting the `**Default**: required` marker
// and any closed `**Valid**: "a", "b", ...` enum list from each `#### \`path\`` entry, and
// cross-checks both against configModel's `required` and `enum` fields — the two M2 facets
// checkDefaultsTables cannot see (a doc row it never reads).

// §11 headers this mapping cannot check (not a single leaf descriptor) — mirrors the
// EXPECTED_UNMAPPED convention in checkDefaultsTables (no silent caps).
const SS11_EXPECTED_UNMAPPED = new Set([
    'structure.severities',   // per-structural-rule key set (rule 55); model uses structure.severities.<rule>
]);

function checkSettingsReference(TV) {
    const errs = [];
    const specPath = coreSpecPath();
    if (!specPath) throw new Error('core spec not found (repo root, $TV_SPEC_DIR, or ../table-validation-spec)');
    const core = fs.readFileSync(specPath, 'utf8');
    const model = new Map();
    for (const s of TV.configModel.settings) {
        model.set(s.path + '|' + s.section, s);
        if (!model.has(s.path)) model.set(s.path, s);
    }
    const lookup = (p, sec) => model.get(sec ? p + '|' + sec : p) || model.get(p);

    const sec11 = core.split('## 11. Settings Reference')[1].split('\n## 12.')[0];

    // split the section into one block per `#### \`path\`` header
    const headerRe = /^#### (`[^\n]+)$/gm;
    const positions = [];
    let hm;
    while ((hm = headerRe.exec(sec11)) !== null) positions.push({ idx: hm.index, header: hm[1] });
    if (positions.length < 40) errs.push(`only ${positions.length} §11 setting headers found — the section parser is likely broken`);

    const unmapped = [];
    let checkedRequired = 0;
    let checkedEnum = 0;

    for (let i = 0; i < positions.length; i++) {
        const body = sec11.slice(positions[i].idx, i + 1 < positions.length ? positions[i + 1].idx : sec11.length);
        // a header may name several sibling paths: `bool.trueValues` / `bool.falseValues`
        const paths = [...positions[i].header.matchAll(/`([^`]+)`/g)].map((mm) => mm[1]);
        const typeLine = /^- \*\*Type\*\*:.*$/m.exec(body);
        if (!typeLine) { errs.push(`§11 ${positions[i].header}: no "- **Type**:" bullet found`); continue; }
        const line = typeLine[0];
        const defMatch = /\*\*Default[s]?\*\*:\s*([^·]+?)\s*(?:·|$)/.exec(line);
        const validMatch = /\*\*Valid\*\*:\s*([^·]+?)\s*(?:·|$)/.exec(line);
        const docRequired = defMatch !== null && defMatch[1].trim() === 'required';
        const validText = validMatch ? validMatch[1].trim() : null;
        const enumVals = validText ? [...validText.matchAll(/"([^"]*)"/g)].map((mm) => mm[1]) : [];

        for (const p of paths) {
            const target = mapDocPath(p);
            const desc = lookup(target.path, target.section);
            if (!desc) {
                if (!SS11_EXPECTED_UNMAPPED.has(p)) unmapped.push(p);
                continue;
            }
            checkedRequired++;
            if (desc.required !== docRequired) {
                errs.push(`§11 ${p}: doc Default=${docRequired ? 'required' : 'not required'}, configModel required=${desc.required}`);
            }
            if (desc.type === 'enum') {
                checkedEnum++;
                if (enumVals.length >= 2) {
                    const a = JSON.stringify(enumVals.slice().sort());
                    const b = JSON.stringify((desc.enum || []).slice().sort());
                    if (a !== b) {
                        errs.push(`§11 ${p}: doc Valid enum ${JSON.stringify(enumVals)} ≠ configModel enum ${JSON.stringify(desc.enum)}`);
                    }
                } else {
                    errs.push(`§11 ${p}: configModel is enum type ${JSON.stringify(desc.enum)} but no closed "Valid" enum list found in the doc row`);
                }
            }
        }
    }
    for (const u of unmapped) errs.push(`§11 setting row has no configModel mapping: ${u}`);
    if (checkedRequired < 60) errs.push(`only ${checkedRequired} §11 required-flags checked — the section parser is likely broken`);
    if (checkedEnum < 5) errs.push(`only ${checkedEnum} §11 enum settings checked — the section parser is likely broken`);
    return { errs, checkedRequired, checkedEnum };
}

// ---- JS profile §8 usage examples, executed verbatim ------------------------------

function runUsageExamples(TV) {
    const errs = [];
    const md = fs.readFileSync(path.join(ROOT, 'table-validation-js-impl-spec-v1.3.2.md'), 'utf8');
    const sec8 = md.split('## 8. Usage Examples')[1].split('## 9.')[0];
    const blocks = [];
    const re = /```html\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(sec8)) !== null) blocks.push(m[1]);
    if (blocks.length < 3) { errs.push(`expected ≥ 3 §8 example blocks, found ${blocks.length}`); return { errs, blocks: blocks.length }; }

    // minimal DOM/browser stubs for the download tails of the examples
    const held = {};
    for (const k of ['document', 'URL']) held[k] = globalThis[k];
    globalThis.document = {
        createElement: () => ({ click() {}, set href(v) {}, get href() { return ''; } }),
    };
    globalThis.URL = Object.assign(function () {}, {
        createObjectURL: () => 'blob:stub', revokeObjectURL: () => {},
    });
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a);
    try {
        for (let i = 0; i < blocks.length; i++) {
            const scripts = [];
            const sre = /<script>([\s\S]*?)<\/script>/g;
            let sm;
            while ((sm = sre.exec(blocks[i])) !== null) scripts.push(sm[1]);
            for (const code of scripts) {
                try {
                    vm.runInThisContext(code, { filename: `js-profile-§8-example-${i + 1}.js` });
                } catch (e) {
                    errs.push(`§8 example ${i + 1} threw: ${e.message}`);
                }
            }
        }
        // example 3 defines onFile(file) — drive it with a real CSV File (Node ≥ 20 has File)
        if (typeof globalThis.onFile === 'function') {
            const file = new File(['id,amount\n1,2.5\n2,7\n'], 'docs.csv', { type: 'text/csv' });
            return Promise.resolve(globalThis.onFile(file)).then(() => {
                console.log = origLog;
                for (const k of Object.keys(held)) globalThis[k] = held[k];
                return { errs, blocks: blocks.length };
            }).catch((e) => {
                console.log = origLog;
                for (const k of Object.keys(held)) globalThis[k] = held[k];
                errs.push(`§8 example 3 (onFile) rejected: ${e.message}`);
                return { errs, blocks: blocks.length };
            });
        }
        errs.push('§8 example 3 did not define onFile');
    } finally {
        console.log = origLog;
        for (const k of Object.keys(held)) if (held[k] === undefined) delete globalThis[k]; else globalThis[k] = held[k];
    }
    return { errs, blocks: blocks.length };
}

module.exports = { checkDefaultsTables, checkSettingsReference, runUsageExamples, coreSpecPath };
