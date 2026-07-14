/* Release checklist gate (WS6 item 9) — plain Node, run as the FINAL check before
 * tagging: `node test/release-check.js`.
 *
 *   1. Version consistency everywhere: dist constants, d.ts, worker header, every
 *      spec document title, spec filenames, README claims, test assertions — all one
 *      unified version; no stale pre-release (2.x/3.x/4.x) mentions anywhere.
 *   2. Every intra-document markdown anchor resolves; every relative file link exists.
 *   3. COVERAGE.md mentions every suite file.
 *   4. docs/user-guide.html embeds exactly the current docs/user-guide.md (the
 *      zero-toolchain viewer must not drift from the source markdown), and the two
 *      single-file deliverables (console-standalone.html, docs/user-guide-standalone.html)
 *      are byte-exactly what docs/make-standalone.py generates from the current sources
 *      — including the pinned SRI hashes matching the current dist/ and console/ bytes.
 *   5. Prints the sha384 SRI hashes + jsDelivr URLs for dist/*.js (for the README /
 *      release notes).
 * Exit 0 = release-ready; 1 = blocking findings (all listed).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const problems = [];
const note = (msg) => problems.push(msg);

// ---------------- 1. version consistency ----------------

globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'dist', 'table-validation.js'), 'utf8'), { filename: 'dist' });
const TV = globalThis.TableValidation;
const V = TV.VERSION;

if (!/^\d+\.\d+\.\d+$/.test(V)) note(`VERSION "${V}" is not semver`);
if (TV.SPEC_VERSION !== V) note(`SPEC_VERSION ${TV.SPEC_VERSION} ≠ VERSION ${V}`);
if (TV.configModel.specVersion !== V) note(`configModel.specVersion ${TV.configModel.specVersion} ≠ ${V}`);

// the language-agnostic documents (core spec, addendum, design-decisions log) live in
// the table-validation-spec repository; this repo carries only the JS-specific two
const SPEC_FILES = [
    `table-validation-js-impl-spec-v${V}.md`,
    `table-validation-ui-architecture-v${V}.md`,
];
for (const f of SPEC_FILES) {
    if (!fs.existsSync(path.join(ROOT, f))) { note(`spec filename missing for ${V}: ${f}`); continue; }
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (!f.includes('design-decisions') && !text.includes(`## Document Version: ${V}`)) {
        note(`${f}: missing "Document Version: ${V}" title`);
    }
}

const dts = fs.readFileSync(path.join(ROOT, 'dist', 'table-validation.d.ts'), 'utf8');
if (!dts.includes(`v${V}`)) note(`d.ts header does not carry v${V}`);
const workerSrc = fs.readFileSync(path.join(ROOT, 'dist', 'table-validation-worker.js'), 'utf8');
if (!workerSrc.includes(`v${V}`)) note(`worker header does not carry v${V}`);
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
if (!readme.includes(`"${V}"`) || !readme.includes(`v${V}`)) note(`README does not claim version ${V}`);
const unitVec = fs.readFileSync(path.join(ROOT, 'test', 'vectors', 'unit.js'), 'utf8');
if (!unitVec.includes(`'${V}'`)) note(`test/vectors/unit.js does not assert version ${V}`);

// no stale working-history versions anywhere (dependency majors like luxon@3/exceljs@4
// and 'Luxon 3.x'/'ExcelJS 4.x' are legitimate and excluded)
const STALE = /\b(?:2|3|4)\.(?:0|1)\.\d+\b/;
const scanFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md'))
    .concat(['dist/table-validation.js', 'dist/table-validation.d.ts', 'dist/table-validation-worker.js',
        'console/store.js', 'console/panels.js', 'console/results.js', 'console/app.js', 'console/ui.js',
        'test/COVERAGE.md', 'test/index.html', 'test/runner.js', 'test/node-runner.js'])
    .concat(fs.readdirSync(path.join(ROOT, 'test', 'vectors')).map((f) => 'test/vectors/' + f));
for (const f of scanFiles) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const clean = lines[i].replace(/luxon@3[^\s"']*/g, '').replace(/exceljs@4[^\s"']*/g, '');
        const m = STALE.exec(clean);
        if (m && m[0] !== V) note(`${f}:${i + 1}: stale version mention "${m[0]}"`);
    }
}

// ---------------- 1b. previous-release literal scan over dist/*.js ----------------
// The exact class that forced the v1.4.0 hotfix: v1.3.1's tagged engine baked a
// hardcoded 'schemaVersion':'1.3.0' literal into an inference draft and the builder's
// default seed, instead of deriving it from SPEC_VERSION — two occurrences the release
// sweep missed (only caught by the live post-tag batch drive). The STALE scan above
// can't catch a recurrence of THIS shape: it only flags major-version jumps (2/3/4.x),
// but this bug class is a stale literal within the SAME major.minor line (e.g. "1.3.0"
// baked in when V is "1.3.2") — a pattern that scan's regex structurally excludes.
// A quoted-string semver literal is a strong, low-noise signal: real dist/*.js source
// documents historical "(1.2.0)"/"since 1.3.0" prose in BARE (unquoted) parenthetical
// comments (35+ such mentions exist and are legitimate), so requiring the surrounding
// quote marks isolates actual string-literal DATA from prose. The two definitional
// literals (`const VERSION = 'X.Y.Z'`, `const SPEC_VERSION = 'X.Y.Z'`) are the only
// expected hits and are asserted equal to V by section 1 above already — any OTHER
// quoted semver-shaped literal in these files is exactly the v1.4.0 bug shape.
// (component width capped at 2 digits + \b boundaries so a coincidental dotted-triplet
// inside an unrelated string — e.g. a "01.07.2026" dd.MM.yyyy example date literal
// elsewhere in the file — cannot false-positive as a semver literal.)
const PREV_RELEASE_LITERAL_FILES = ['dist/table-validation.js', 'dist/table-validation-worker.js'];
const QUOTED_SEMVER_RE = /['"]\b([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,2})\b['"]/g;
for (const f of PREV_RELEASE_LITERAL_FILES) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        let m;
        QUOTED_SEMVER_RE.lastIndex = 0;
        while ((m = QUOTED_SEMVER_RE.exec(lines[i])) !== null) {
            if (m[1] !== V) note(`${f}:${i + 1}: previous-release literal "${m[1]}" baked into dist (expected ${V}, derive from VERSION/SPEC_VERSION instead)`);
        }
    }
}

// ---------------- 2. markdown anchors + relative links ----------------

function slug(heading) {
    return heading.toLowerCase()
        .replace(/[^\p{L}\p{N} -]/gu, '')
        .replace(/ /g, '-');
}

// extracts a file's own heading anchors (fence-aware); shared by the anchor/link
// checker below and the TOC-completeness / §-reference checks further down.
function headingAnchors(text) {
    const anchors = new Set();
    const counts = new Map();
    let inFence = false;
    for (const line of text.split('\n')) {
        if (line.startsWith('```')) { inFence = !inFence; continue; }
        if (inFence) continue;
        const h = /^#{1,6}\s+(.*)$/.exec(line);
        if (!h) continue;
        const base = slug(h[1].trim());
        const n = counts.get(base) || 0;
        counts.set(base, n + 1);
        anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    return anchors;
}

// checks every in-doc `#anchor` link and every relative `file` / `file#anchor` link
// in a single markdown file. `label` is used only for note() messages (so callers
// outside ROOT — e.g. the sibling spec repo — can still report readable paths).
function checkMarkdownFile(absPath, label) {
    const text = fs.readFileSync(absPath, 'utf8');
    const anchors = headingAnchors(text);
    const linkRe = /\]\(([^)\s]+)\)/g;
    let m;
    let inFence = false;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('```')) { inFence = !inFence; continue; }
        if (inFence) continue;
        while ((m = linkRe.exec(lines[i])) !== null) {
            const target = m[1];
            if (/^[a-z]+:/.test(target)) continue;                       // http(s), mailto
            if (target.startsWith('#')) {
                if (!anchors.has(target.slice(1))) note(`${label}:${i + 1}: unresolved anchor ${target}`);
            } else {
                const [file, anchor] = target.split('#');
                const abs = path.join(path.dirname(absPath), file);
                if (!fs.existsSync(abs)) { note(`${label}:${i + 1}: linked file missing: ${file}`); continue; }
                if (anchor) {
                    // cross-file anchors: verify against that file's headings
                    const otherAnchors = headingAnchors(fs.readFileSync(abs, 'utf8'));
                    if (!otherAnchors.has(anchor)) note(`${label}:${i + 1}: unresolved cross-file anchor ${target}`);
                }
            }
        }
    }
}

const MD_FILES = fs.readdirSync(ROOT).filter((x) => x.endsWith('.md'))
    .concat(fs.readdirSync(path.join(ROOT, 'docs')).filter((x) => x.endsWith('.md')).map((x) => 'docs/' + x));
for (const f of MD_FILES) checkMarkdownFile(path.join(ROOT, f), f);

// TOC completeness: every ##/### heading (other than the doc's own "Document
// Version" metadata line) must have a corresponding entry in that doc's own
// "## Table of Contents" block — catches an added/renamed section that the ToC
// itself was never updated for (a real drift class: B036).
function checkTocCompleteness(absPath, label) {
    const text = fs.readFileSync(absPath, 'utf8');
    const lines = text.split('\n');
    const tocStart = lines.findIndex((l) => /^## Table of Contents/.test(l));
    if (tocStart === -1) return;                       // doc has no ToC — nothing to check
    let tocEnd = lines.length;
    for (let i = tocStart + 1; i < lines.length; i++) { if (/^## /.test(lines[i])) { tocEnd = i; break; } }
    const tocAnchors = new Set();
    for (let i = tocStart; i < tocEnd; i++) {
        const m = /\]\(#([^)]+)\)/.exec(lines[i]);
        if (m) tocAnchors.add(m[1]);
    }
    const counts = new Map();
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('```')) { inFence = !inFence; continue; }
        if (inFence) continue;
        if (i >= tocStart && i < tocEnd) continue;      // the ToC block itself
        const h = /^(#{2,3})\s+(.*)$/.exec(lines[i]);
        if (!h) continue;
        if (/^Document Version:/.test(h[2].trim())) continue;   // metadata line, not content
        const base = slug(h[2].trim());
        const n = counts.get(base) || 0;
        counts.set(base, n + 1);
        const anchor = n === 0 ? base : `${base}-${n}`;
        if (!tocAnchors.has(anchor)) note(`${label}:${i + 1}: heading "${h[2].trim()}" missing from the Table of Contents`);
    }
}
for (const f of MD_FILES) checkTocCompleteness(path.join(ROOT, f), f);
// COVERAGE.md links live under test/
{
    const cov = fs.readFileSync(path.join(ROOT, 'test', 'COVERAGE.md'), 'utf8');
    const linkRe = /\]\(([^)#\s]+)\)/g;
    let m;
    while ((m = linkRe.exec(cov)) !== null) {
        if (/^[a-z]+:/.test(m[1])) continue;
        if (!fs.existsSync(path.join(ROOT, 'test', m[1]))) note(`test/COVERAGE.md: linked file missing: ${m[1]}`);
    }
}

// ---------------- 2b. spec-repo markdown integrity (B036) ----------------
// The Core Spec, Addendum, and Design-Decisions Log are normative but live in the
// sibling table-validation (spec) repository, not here — SPEC_FILES above lists only
// this repo's two JS-specific docs. Previously nothing re-ran the anchor/link/ToC
// checks above against that repo, so its ~700 §-refs, 434+61 anchors, and 98+29 ToC
// entries were hand-checked only. Reuse the exact same machinery here.
const docsTests = require('./docs-tests.js');
const coreSpecFile = docsTests.coreSpecPath();
const SPEC_DIR = coreSpecFile ? path.dirname(coreSpecFile) : null;
let SPEC_MD_FILES = [];
if (SPEC_DIR) {
    SPEC_MD_FILES = fs.readdirSync(SPEC_DIR).filter((x) => x.endsWith('.md'));
    for (const f of SPEC_MD_FILES) {
        checkMarkdownFile(path.join(SPEC_DIR, f), `<spec>/${f}`);
        checkTocCompleteness(path.join(SPEC_DIR, f), `<spec>/${f}`);
    }
    // version headers: the spec set's own two documents that carry one (the
    // Design-Decisions Log and README are non-normative prose, no such header)
    for (const f of [`table-validation-core-spec-v${V}.md`, `table-validation-authoring-tooling-addendum-v${V}.md`]) {
        const p = path.join(SPEC_DIR, f);
        if (!fs.existsSync(p)) { note(`<spec>/${f} not found for v${V}`); continue; }
        const text = fs.readFileSync(p, 'utf8');
        if (!text.includes(`## Document Version: ${V}`)) note(`<spec>/${f}: missing "Document Version: ${V}" header`);
    }
} else {
    console.log('\n(spec repo not found — B036/B037 spec-repo checks SKIPPED; set $TV_SPEC_DIR or clone table-validation as a sibling to enable them)');
}

// ---------------- 2c. §-references resolve; rule-count/range phrases are honest (B037) ----------------
// Neither §-style cross-references (bare prose, not just markdown links) nor the
// rule-count summary phrases ("rules 1–58", "I1–I13", …) were machine-checked
// anywhere; three stale-range drifts (impl "1–57", core/addendum "I1–I12") sailed
// through release-check before because this class was unautomated.
// Requires the spec repo (JS-repo docs reference Core Spec/Addendum section numbers
// that only resolve once that corpus is included — see the SPEC_DIR skip message above).
if (SPEC_DIR) {
    const ALL_DOC_FILES = MD_FILES.map((f) => ({ abs: path.join(ROOT, f), label: f }))
        .concat(SPEC_MD_FILES.map((f) => ({ abs: path.join(SPEC_DIR, f), label: `<spec>/${f}` })));

    // 1) every bare "§<id>" token (numeric §10 / §10.2, or letter-led §A / §A.6) must
    // match a real heading SOMEWHERE in the corpus (headings are attributed per-file
    // by the anchor checks above; this pass only asks "does this section id exist at
    // all", which is enough to catch a renumbered/removed section going stale).
    const HEADING_ID_RE = /^#{2,6}\s+((?:[A-Z]|\d+)(?:\.\d+)*)\.?\s+\S/;
    const ALL_SECTION_IDS = new Set();
    for (const { abs } of ALL_DOC_FILES) {
        const text = fs.readFileSync(abs, 'utf8');
        let inFence = false;
        for (const line of text.split('\n')) {
            if (line.startsWith('```')) { inFence = !inFence; continue; }
            if (inFence) continue;
            const h = HEADING_ID_RE.exec(line);
            if (h) ALL_SECTION_IDS.add(h[1]);
        }
    }
    const SECTION_REF_RE = /§((?:[A-Z]|\d+)(?:\.\d+)*)/g;
    for (const { abs, label } of ALL_DOC_FILES) {
        const text = fs.readFileSync(abs, 'utf8');
        const lines = text.split('\n');
        let inFence = false;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('```')) { inFence = !inFence; continue; }
            if (inFence) continue;
            let m;
            SECTION_REF_RE.lastIndex = 0;
            while ((m = SECTION_REF_RE.exec(lines[i])) !== null) {
                if (!ALL_SECTION_IDS.has(m[1])) note(`${label}:${i + 1}: §${m[1]} does not match any known section heading`);
            }
        }
    }

    // 2) rule-count/range phrases: derive the ACTUAL rule counts by parsing the
    // defining lists (Core Spec §10, §15.12 C-rules, Addendum A.6/B.9/C.10), then
    // require every "rules N–M" / "<letter>N–<letter>M" phrase found anywhere to
    // reference real rule numbers, and every phrase starting at 1 to claim the true
    // total exactly (this is the specific shape the three historical stale counts had).
    if (SPEC_DIR) {
        const core = fs.readFileSync(path.join(SPEC_DIR, `table-validation-core-spec-v${V}.md`), 'utf8');
        const addendum = fs.readFileSync(path.join(SPEC_DIR, `table-validation-authoring-tooling-addendum-v${V}.md`), 'utf8');

        function sectionBody(text, startRe, stopRe) {
            const lines = text.split('\n');
            const s = lines.findIndex((l) => startRe.test(l));
            if (s === -1) return '';
            let e = lines.length;
            for (let i = s + 1; i < lines.length; i++) { if (stopRe.test(lines[i])) { e = i; break; } }
            return lines.slice(s, e).join('\n');
        }
        function maxOf(nums, label) {
            if (!nums.length) { note(`could not locate any ${label} rule items — parser drifted from the doc structure`); return null; }
            const sorted = nums.slice().sort((a, b) => a - b);
            for (let i = 0; i < sorted.length; i++) {
                if (sorted[i] !== i + 1) { note(`${label} rules are not contiguous from 1: found ${sorted.join(',')}`); break; }
            }
            return sorted[sorted.length - 1];
        }

        const rule10Body = sectionBody(core, /^## 10\. /, /^## /);
        const maxPlain = maxOf([...rule10Body.matchAll(/^(\d+)\.\s/gm)].map((m) => +m[1]), '§10');

        const maxC = maxOf([...sectionBody(core, /^### 15\.12 /, /^#{2,3} /).matchAll(/^-\s+\*\*C(\d+)\.\*\*/gm)].map((m) => +m[1]), 'C (§15.12)');
        const maxM = maxOf([...sectionBody(addendum, /^### A\.6 /, /^#{2,3} /).matchAll(/^-\s+\*\*M(\d+)\.\*\*/gm)].map((m) => +m[1]), 'M (§A.6)');
        const maxI = maxOf([...sectionBody(addendum, /^### B\.9 /, /^#{2,3} /).matchAll(/^-\s+\*\*I(\d+)\.\*\*/gm)].map((m) => +m[1]), 'I (§B.9)');
        const maxN = maxOf([...sectionBody(addendum, /^### C\.10 /, /^#{2,3} /).matchAll(/^-\s+\*\*N(\d+)\.\*\*/gm)].map((m) => +m[1]), 'N (§C.10)');
        const MAX_BY_LETTER = { M: maxM, I: maxI, C: maxC, N: maxN };

        // one known legitimate exception: a partial, not a stale full-range claim —
        // see table-validation-js-impl-spec-v1.4.0.md:349 ("(rules M1–M5)", the subset
        // of M-rules relevant to `configModel` specifically, not the whole M1–M8 set).
        const ALLOWED_PARTIAL_FROM_ONE = new Set(['M1–M5', 'M1-M5']);

        for (const { abs, label } of ALL_DOC_FILES) {
            const text = fs.readFileSync(abs, 'utf8');
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                let m;
                const numRe = /\brules?\s+(\d+)[–-](\d+)\b/gi;
                while ((m = numRe.exec(line)) !== null) {
                    const a = +m[1], b = +m[2];
                    if (maxPlain != null && (a < 1 || b > maxPlain || a > b)) {
                        note(`${label}:${i + 1}: rule range "${m[0]}" out of bounds (actual rules 1–${maxPlain})`);
                    } else if (a === 1 && maxPlain != null && b !== maxPlain) {
                        note(`${label}:${i + 1}: rule range "${m[0]}" claims the full set but actual is 1–${maxPlain}`);
                    }
                }
                const letterRe = /\b([MICN])(\d+)[–-]\1?(\d+)\b/g;
                while ((m = letterRe.exec(line)) !== null) {
                    const letter = m[1], a = +m[2], b = +m[3], max = MAX_BY_LETTER[letter];
                    if (max == null) continue;
                    if (a < 1 || b > max || a > b) {
                        note(`${label}:${i + 1}: rule range "${m[0]}" out of bounds (actual ${letter}1–${letter}${max})`);
                    } else if (a === 1 && b !== max && !ALLOWED_PARTIAL_FROM_ONE.has(m[0])) {
                        note(`${label}:${i + 1}: rule range "${m[0]}" claims the full set but actual is ${letter}1–${letter}${max}`);
                    }
                }
            }
        }
    }
}

// ---------------- 3. COVERAGE.md mentions every suite file ----------------

{
    const cov = fs.readFileSync(path.join(ROOT, 'test', 'COVERAGE.md'), 'utf8');
    const suiteFiles = fs.readdirSync(path.join(ROOT, 'test', 'vectors')).filter((f) => f.endsWith('.js'))
        .map((f) => 'vectors/' + f)
        .concat(['runner.js', 'node-runner.js', 'worker.html', 'bench.js', 'docs-tests.js', 'release-check.js']);
    for (const f of suiteFiles) {
        if (!cov.includes(f)) note(`test/COVERAGE.md does not mention ${f}`);
    }
}

// ---------------- 4. user-guide.html embeds the current user-guide.md ----------------

{
    const html = fs.readFileSync(path.join(ROOT, 'docs', 'user-guide.html'), 'utf8');
    const md = fs.readFileSync(path.join(ROOT, 'docs', 'user-guide.md'), 'utf8');
    const m = /<script type="text\/markdown" id="guide-src">\n([\s\S]*?)<\/script>/.exec(html);
    if (!m) note('docs/user-guide.html: embedded markdown block not found');
    else if (m[1] !== md) note('docs/user-guide.html: embedded markdown is out of sync with docs/user-guide.md — rerun docs/sync-guide-html.py');
}

// the single-file deliverables must be byte-exactly what docs/make-standalone.py
// generates from the CURRENT sources (same rules re-applied here in Node) — this is
// what catches a console/*.js edit that stales the pinned integrity hashes
{
    const TAG = 'v1.4.0';
    const CDN = `https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@${TAG}`;
    const GH = `https://github.com/sergeiosipov/table-validation-js/blob/${TAG}`;
    const SCRIPTS = ['dist/table-validation.js', 'console/ui.js', 'console/store.js',
        'console/panels.js', 'console/results.js', 'console/app.js'];
    const sri = (rel) => 'sha384-' + crypto.createHash('sha384')
        .update(fs.readFileSync(path.join(ROOT, rel))).digest('base64');

    const consoleHtml = fs.readFileSync(path.join(ROOT, 'console.html'), 'utf8');
    const startMarker = '    <script>\n        // engine + console scripts';
    const start = consoleHtml.indexOf(startMarker);
    const end = consoleHtml.indexOf('</script>', start) + '</script>'.length;
    const tags = SCRIPTS.map((rel) =>
        `    <script src="${CDN}/${rel}"\n            integrity="${sri(rel)}" crossorigin="anonymous"></script>`).join('\n');
    const block =
        '    <!-- STANDALONE BUILD: this single file is the whole deliverable. Every\n' +
        '         script is pinned to the immutable v1.4.0 tag on jsDelivr with\n' +
        '         subresource integrity. Generated by docs/make-standalone.py from\n' +
        '         console.html; kept in sync by test/release-check.js. -->\n' +
        '    <script>\n' +
        '        // a single file has no sibling worker script to load — force the\n' +
        '        // engines onto the main thread (the console\'s normal file:// behavior)\n' +
        '        window.Worker = undefined;\n' +
        '    </script>\n' + tags;
    const expectedConsole = consoleHtml.slice(0, start) + block + consoleHtml.slice(end);
    const actualConsole = fs.readFileSync(path.join(ROOT, 'console-standalone.html'), 'utf8');
    if (actualConsole !== expectedConsole) note('console-standalone.html is out of sync — rerun docs/make-standalone.py');

    let guide = fs.readFileSync(path.join(ROOT, 'docs', 'user-guide.html'), 'utf8');
    guide = guide.replace('<!doctype html>',
        '<!doctype html>\n<!-- STANDALONE BUILD: screenshots/examples load from the immutable\n' +
        '     v1.4.0 tag on jsDelivr; repo links point at GitHub. Generated by\n' +
        '     docs/make-standalone.py from user-guide.html (do not edit by hand). -->');
    guide = guide.split('](img/').join(`](${CDN}/docs/img/`);
    guide = guide.split('](examples/').join(`](${CDN}/docs/examples/`);
    guide = guide.split('](make-screenshots.py)').join(`](${GH}/docs/make-screenshots.py)`);
    guide = guide.split('](../').join(`](${GH}/`);
    guide = guide.split('<a href="user-guide.md">').join(`<a href="${GH}/docs/user-guide.md">`);
    const actualGuide = fs.readFileSync(path.join(ROOT, 'docs', 'user-guide-standalone.html'), 'utf8');
    if (actualGuide !== guide) note('docs/user-guide-standalone.html is out of sync — rerun docs/make-standalone.py');
}

// ---------------- 5. SRI hashes ----------------

console.log(`release-check for table-validation v${V}`);
console.log('\nSRI (sha384) for the dist artifacts — pin these with the jsDelivr URLs:');
// B038: these were computed and printed for eyeball comparison only — never asserted
// against README.md's own SRI table, so a hash/README mismatch never failed the gate.
// At release time the working-tree dist bytes ARE the future tag's bytes (the release
// commit doesn't touch dist/ again), so this is a free, network-less assertion.
const README_SRI_FILES = ['table-validation.js', 'table-validation-worker.js'];
for (const f of fs.readdirSync(path.join(ROOT, 'dist'))) {
    if (!f.endsWith('.js')) continue;
    const bytes = fs.readFileSync(path.join(ROOT, 'dist', f));
    const h = crypto.createHash('sha384').update(bytes).digest('base64');
    console.log(`  ${f}`);
    console.log(`    url:       https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@v${V}/dist/${f}`);
    console.log(`    integrity: sha384-${h}`);
    if (README_SRI_FILES.includes(f) && !readme.includes(`sha384-${h}`)) {
        note(`README.md does not contain the current sha384 integrity hash for dist/${f} (sha384-${h}) — rerun release-check and update the CDN & SRI table`);
    }
}

console.log('');
if (problems.length) {
    console.log(`NOT RELEASE-READY — ${problems.length} finding(s):`);
    for (const p of problems) console.log('  ✖ ' + p);
    process.exit(1);
}
console.log('RELEASE-READY: version consistency, anchors, links, and coverage all check out.');
