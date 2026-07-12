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

// ---------------- 2. markdown anchors + relative links ----------------

function slug(heading) {
    return heading.toLowerCase()
        .replace(/[^\p{L}\p{N} -]/gu, '')
        .replace(/ /g, '-');
}

const MD_FILES = fs.readdirSync(ROOT).filter((x) => x.endsWith('.md'))
    .concat(fs.readdirSync(path.join(ROOT, 'docs')).filter((x) => x.endsWith('.md')).map((x) => 'docs/' + x));
for (const f of MD_FILES) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
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
    const linkRe = /\]\(([^)\s]+)\)/g;
    let m;
    inFence = false;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('```')) { inFence = !inFence; continue; }
        if (inFence) continue;
        while ((m = linkRe.exec(lines[i])) !== null) {
            const target = m[1];
            if (/^[a-z]+:/.test(target)) continue;                       // http(s), mailto
            if (target.startsWith('#')) {
                if (!anchors.has(target.slice(1))) note(`${f}:${i + 1}: unresolved anchor ${target}`);
            } else {
                const [file, anchor] = target.split('#');
                const abs = path.join(ROOT, path.dirname(f), file);
                if (!fs.existsSync(abs)) { note(`${f}:${i + 1}: linked file missing: ${file}`); continue; }
                if (anchor) {
                    // cross-file anchors: verify against that file's headings
                    const other = fs.readFileSync(abs, 'utf8');
                    const otherAnchors = new Set();
                    let fenced = false;
                    for (const l of other.split('\n')) {
                        if (l.startsWith('```')) { fenced = !fenced; continue; }
                        if (fenced) continue;
                        const hh = /^#{1,6}\s+(.*)$/.exec(l);
                        if (hh) otherAnchors.add(slug(hh[1].trim()));
                    }
                    if (!otherAnchors.has(anchor)) note(`${f}:${i + 1}: unresolved cross-file anchor ${target}`);
                }
            }
        }
    }
}
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
    const TAG = 'v1.0.0';
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
        '         script is pinned to the immutable v1.0.0 tag on jsDelivr with\n' +
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
        '     v1.0.0 tag on jsDelivr; repo links point at GitHub. Generated by\n' +
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
for (const f of fs.readdirSync(path.join(ROOT, 'dist'))) {
    if (!f.endsWith('.js')) continue;
    const bytes = fs.readFileSync(path.join(ROOT, 'dist', f));
    const h = crypto.createHash('sha384').update(bytes).digest('base64');
    console.log(`  ${f}`);
    console.log(`    url:       https://cdn.jsdelivr.net/gh/sergeiosipov/table-validation-js@v${V}/dist/${f}`);
    console.log(`    integrity: sha384-${h}`);
}

console.log('');
if (problems.length) {
    console.log(`NOT RELEASE-READY — ${problems.length} finding(s):`);
    for (const p of problems) console.log('  ✖ ' + p);
    process.exit(1);
}
console.log('RELEASE-READY: version consistency, anchors, links, and coverage all check out.');
