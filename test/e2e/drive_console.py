"""Headless console E2E drive (file://): ingest (incl. normalization editor), infer,
accept, validate, results; run-to-run delta; undo/redo; advanced mode; workspace
round-trip; dialogs. Usage: drive_console.py [chromium|firefox|webkit]"""
import sys, pathlib
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

repo = pathlib.Path(__file__).resolve().parents[2]
url = (repo / "console.html").as_uri()
browser_name = sys.argv[1] if len(sys.argv) > 1 else "chromium"
errors = []

with sync_playwright() as p:
    browser = getattr(p, browser_name).launch()
    page = browser.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("() => !!window.__tvconsole", timeout=30000)

    # F1 fast path: pick a CSV file, ingest, infer, accept, run validate
    page.evaluate("""async () => {
        const s = window.__tvconsole;
        const csv = 'id,amount,day\\n1,10.5,2026-01-02\\n2,3.25,2026-01-03\\n2,x,2026-01-04\\n';
        const file = new File([csv], 'drive.csv', { type: 'text/csv' });
        s.dispatch.pickFile('produced', file);
        await s.dispatch.ingest('produced');
        if (s.state.data.produced.status !== 'ready') throw new Error('ingest not ready: ' + JSON.stringify(s.state.data.produced.error));
        s.dispatch.inferRun();
        if (s.state.inference.status !== 'offered') throw new Error('no inference offer');
        s.dispatch.inferAccept();
        if (!s.state.authoring.lastValidation.valid) throw new Error('draft not authoring-valid: ' + JSON.stringify(s.state.authoring.lastValidation.errors));
        s.dispatch.edit('columns.id.unique.enabled', true);
        s.dispatch.run('validate');
        if (s.state.run.status !== 'done') throw new Error('run failed: ' + JSON.stringify(s.state.run.error));
        const rep = s.state.run.report;
        if (rep.verdict !== 'fail') throw new Error('expected verdict fail (dup id + bad float), got ' + rep.verdict);
    }""")
    page.wait_for_timeout(300)
    # UI shows the report view on the Run tab
    body = page.inner_text("#app")
    assert "Invalid" in body or "✖" in body, "report verdict line not rendered"

    # WS5: run-to-run delta — fix the duplicate id, re-run, delta becomes the default view
    page.evaluate("""async () => {
        const s = window.__tvconsole;
        s.dispatch.edit('columns.id.unique.enabled', undefined);
        await s.dispatch.run('validate');
        if (s.state.ui.resultView !== 'delta') throw new Error('expected the delta view after a re-run, got ' + s.state.ui.resultView);
        if (!s.state.run.previous) throw new Error('previous run not kept');
        const prevErr = s.state.run.previous.result.summary.bySeverity.error;
        const curErr = s.state.run.result.summary.bySeverity.error;
        if (!(curErr < prevErr)) throw new Error('expected fewer errors after the fix: ' + prevErr + ' -> ' + curErr);
    }""")
    page.wait_for_timeout(200)
    assert "resolved" in page.inner_text("#app"), "delta view not rendered"

    # WS5: undo/redo — the unique.enabled unset can be undone
    page.evaluate("""() => {
        const s = window.__tvconsole;
        const before = JSON.stringify(s.state.authoring.doc);
        s.dispatch.undo();
        const afterUndo = JSON.stringify(s.state.authoring.doc);
        if (afterUndo === before) throw new Error('undo changed nothing');
        s.dispatch.redo();
        if (JSON.stringify(s.state.authoring.doc) !== before) throw new Error('redo did not restore');
    }""")

    # WS5: advanced mode — custom fn referenced by a check compiles and runs (main thread)
    page.evaluate("""async () => {
        const s = window.__tvconsole;
        s.dispatch.mutate((d) => { d.customRowChecks = [{ name: 'pos', type: 'custom', fn: 'positive', severity: 'warning' }]; });
        let r = s.readiness();
        if (r.canValidate) throw new Error('guardrail should block: custom fn without a registry');
        s.dispatch.advancedSetEnabled(true);
        s.dispatch.advancedEdit(0, 'name', 'positive');
        s.dispatch.advancedEdit(0, 'src', '(row, interpreted, i, p) => interpreted.amount !== null && interpreted.amount <= 0 ? [{ field: "amount", pass: false, message: "must be positive" }] : []');
        r = s.readiness();
        if (!r.canValidate) throw new Error('advanced registry should unblock: ' + JSON.stringify(r.reasons.validate));
        await s.dispatch.run('validate');
        if (s.state.run.status !== 'done') throw new Error('advanced run failed: ' + JSON.stringify(s.state.run.error));
        if (s.state.run.viaWorker) throw new Error('registry runs must stay on the main thread');
        s.dispatch.advancedSetEnabled(false);
        s.dispatch.mutate((d) => { delete d.customRowChecks; });
    }""")

    # WS5: workspace export/import round-trip
    page.evaluate("""() => {
        const s = window.__tvconsole;
        s.dispatch.setReferenceInstant('2026-07-08T12:00:00Z');
        const json = s.dispatch.workspaceExportJson();
        const ws = JSON.parse(json);
        if (ws.tvconsoleWorkspace !== 1 || !ws.config || !ws.dataStubs.produced) throw new Error('workspace bundle incomplete: ' + json.slice(0, 200));
        if (JSON.stringify(ws).includes('drive.csv,rows')) throw new Error('workspace must not embed table data');
        s.dispatch.workspaceImport(json, 'ws.json');
        if (s.state.data.produced.status !== 'empty' || !s.state.data.produced.stub) throw new Error('import should leave a re-upload stub');
        if (s.state.run.referenceInstant !== '2026-07-08T12:00:00Z') throw new Error('referenceInstant not restored');
        if (!s.state.authoring.lastValidation.valid) throw new Error('imported config not authoring-valid');
    }""")

    # WS5: inline dialog machinery (replaces confirm/prompt)
    page.evaluate("""() => {
        const s = window.__tvconsole;
        let hit = false;
        s.dispatch.dialogOpen({ kind: 'confirm', title: 'T', text: 'x', onOk: () => { hit = true; } });
        if (!s.state.ui.dialog) throw new Error('dialog not open');
        s.dispatch.dialogOk();
        if (!hit || s.state.ui.dialog) throw new Error('dialog ok flow broken');
    }""")
    page.wait_for_timeout(200)

    # normalization flow (§B.8): messy CSV + step-list editor state → ingest → provenance counts
    page.evaluate("""async () => {
        const s = window.__tvconsole;
        const csv = 'id,amount\\n 1 ,"1 234,50"\\n2,NA\\n';
        s.dispatch.pickFile('produced', new File([csv], 'messy.csv', { type: 'text/csv' }));
        s.dispatch.mutateIngestForm('produced', (f) => {
            f.norm.table.push({ fn: 'trim', params: '' });
            f.norm.columns.push({ key: 'amount', steps: [
                { fn: 'nullCoerce', params: '{"equivalents":["NA"]}' },
                { fn: 'reformatNumber', params: '{"format":{"decimalSeparator":",","groupingSeparators":[" "]}}' },
            ]});
        });
        await s.dispatch.ingest('produced');
        const slot = s.state.data.produced;
        if (slot.status !== 'ready') throw new Error('normalized ingest failed: ' + JSON.stringify(slot.error));
        const acts = slot.normalizationActions;
        if (!acts || acts.length < 2) throw new Error('normalizationActions missing: ' + JSON.stringify(acts));
        if (slot.table.rows[0][1] !== '1234.50' || slot.table.rows[1][1] !== null) {
            throw new Error('normalized cells wrong: ' + JSON.stringify(slot.table.rows));
        }
        s.dispatch.setTab('data');
    }""")
    page.wait_for_timeout(300)
    assert "normalized:" in page.inner_text("#app"), "provenance line lacks normalization counts"
    # exercise the errors view + a comparison round-trip via store-level compare
    page.evaluate("""async () => {
        const s = window.__tvconsole;
        s.dispatch.setResultView('errors');
    }""")
    page.wait_for_timeout(200)

    # full-surface coverage (UI arch §11): paste-data source, allAcceptingFormats,
    # messageTemplates threaded through the run
    page.evaluate("""async () => {
        const s = window.__tvconsole;
        // paste jsonObjects — the string source subsumes the adapters
        s.dispatch.pasteText('produced', '[{"id":1,"day":"2026-07-15"},{"id":2,"day":"16.07.2026"}]');
        if (s.state.data.produced.form.format !== 'jsonObjects') throw new Error('paste format suggestion wrong: ' + s.state.data.produced.form.format);
        await s.dispatch.ingest('produced');
        if (s.state.data.produced.status !== 'ready') throw new Error('pasted ingest failed: ' + JSON.stringify(s.state.data.produced.error));
        if (s.state.data.produced.table.rows.length !== 2) throw new Error('pasted rows wrong');
        // allAcceptingFormats reaches inferConfig: the mixed-date column infers date
        s.dispatch.setInferOption('allAcceptingFormats', true);
        s.dispatch.inferRun();
        const col = s.state.inference.offer.report.columns.find((c) => c.name === 'day');
        if (col.inferredType !== 'date') throw new Error('allAcceptingFormats not applied: day inferred ' + col.inferredType);
        if (s.state.inference.offer.draft.columns.day.type.formats.length < 2) throw new Error('draft lacks the union formats');
        s.dispatch.inferAccept();
        // messageTemplates: custom wording lands in the rendered result
        s.dispatch.edit('columns.id.type.name', 'string');
        s.dispatch.edit('columns.id.type.regex', '^x$');
        s.dispatch.setMessageTemplates('{"typeMismatch": "CUSTOM-TPL {expectedType} vs {actualType}", "regexMismatch": "CUSTOM-RGX"}');
        await s.dispatch.run('validate');
        if (s.state.run.status !== 'done') throw new Error('templated run failed: ' + JSON.stringify(s.state.run.error));
        const msgs = s.state.run.result.summary.details.map((d) => d.message).join(' | ');
        if (!msgs.includes('CUSTOM-TPL') && !msgs.includes('CUSTOM-RGX')) throw new Error('messageTemplates not applied: ' + msgs);
        // bad templates fail soft with a named error, run state failed
        s.dispatch.setMessageTemplates('{oops');
        await s.dispatch.run('validate');
        if (s.state.run.status !== 'failed' || s.state.run.error.name !== 'messageTemplates') {
            throw new Error('template parse guard missing: ' + JSON.stringify(s.state.run.error));
        }
        s.dispatch.setMessageTemplates('');
    }""")
    page.wait_for_timeout(200)

    # B033 / UI arch §5: the "+ from example" button compiles a NumberFormat example
    # and APPENDS it to the column's formats array (preview-before-commit, never silent).
    # Real DOM path through console/ui.js exampleCompiler on a float column's type editor.
    page.evaluate("""() => {
        const s = window.__tvconsole;
        s.dispatch.mutate((d) => { d.columns = { price: { type: { name: 'float' } } }; });
        s.dispatch.setTab('schema');
        s.dispatch.selectSchema('_columns', 'price');
    }""")
    page.wait_for_selector(".fmt-example input")
    page.locator(".fmt-example input").first.fill("1.234,50")
    page.wait_for_selector(".fmt-example button.mini")
    page.locator(".fmt-example button.mini").first.click()
    page.evaluate("""() => {
        const s = window.__tvconsole;
        const fmts = ((s.state.authoring.doc.columns.price.type || {}).formats) || [];
        const f = fmts[0] || {};
        const ok = fmts.length === 1 && f.decimalSeparator === ',' &&
            Array.isArray(f.groupingSeparators) && f.groupingSeparators.length === 1 && f.groupingSeparators[0] === '.';
        if (!ok) throw new Error('example compiler did not append the compiled format: ' + JSON.stringify(fmts));
        if (!s.state.authoring.lastValidation.valid) throw new Error('appended format left the config authoring-invalid: ' + JSON.stringify(s.state.authoring.lastValidation.errors));
    }""")

    # B034 / 1.3.0 console guardrail: a dotted/bracketed INFERRED column name validates
    # fine but cannot be addressed by the per-column dotted-path editor — inferAccept must
    # warn (store.js). The notice must render as a STYLED 'notice warn' (guards the C4
    # wrong-notice-kind styling bug: a bad kind yields an unstyled 'notice <kind>').
    page.evaluate("""async () => {
        const s = window.__tvconsole;
        s.state.ui.notices.length = 0;
        s.dispatch.pasteText('produced', '[{"price.eur":1.5,"qty":2},{"price.eur":2.5,"qty":3}]');
        await s.dispatch.ingest('produced');
        if (s.state.data.produced.status !== 'ready') throw new Error('dotted-header ingest failed: ' + JSON.stringify(s.state.data.produced.error));
        s.dispatch.inferRun();
        if (s.state.inference.status !== 'offered') throw new Error('no inference offer for the dotted-header table');
        if (!s.state.inference.offer.draft.columns['price.eur']) throw new Error('draft omitted the dotted column');
        s.dispatch.inferAccept();
        const warn = s.state.ui.notices.find((n) => n.kind === 'warn' && n.text.indexOf('or brackets') >= 0);
        if (!warn) throw new Error('dotted-name guardrail warning missing: ' + JSON.stringify(s.state.ui.notices));
    }""")
    page.wait_for_timeout(150)
    assert page.locator(".notice.warn", has_text="or brackets").count() >= 1, "dotted-name warning not rendered as a styled 'notice warn'"

    # B034: the rename guard (panels.js) rejects a dotted target with an error notice and
    # leaves the column untouched — driven through the real rename control.
    page.evaluate("""() => {
        const s = window.__tvconsole;
        s.state.ui.notices.length = 0;
        s.dispatch.setTab('schema');
        s.dispatch.selectSchema('_columns', 'qty');
    }""")
    page.wait_for_selector(".card-title input.narrow")
    page.locator(".card-title input.narrow").first.fill("a.b")
    page.get_by_role("button", name="rename").click()
    page.evaluate("""() => {
        const s = window.__tvconsole;
        const err = s.state.ui.notices.find((n) => n.kind === 'error' && n.text.indexOf('must not contain') >= 0);
        if (!err) throw new Error('rename dotted-name guard missing: ' + JSON.stringify(s.state.ui.notices));
        if (s.state.authoring.doc.columns['a.b']) throw new Error('rename to a dotted name should have been blocked');
    }""")

    # B034: the add-column guard rejects a dotted new name (same guard, add path).
    page.get_by_role("button", name="+ add", exact=True).click()
    page.evaluate("""() => {
        const s = window.__tvconsole;
        if (!s.state.ui.dialog) throw new Error('add-column dialog did not open');
        s.state.ui.notices.length = 0;
        s.dispatch.dialogSetValue('c.d');
        s.dispatch.dialogOk();
        const err = s.state.ui.notices.find((n) => n.kind === 'error' && n.text.indexOf('must not contain') >= 0);
        if (!err) throw new Error('add-column dotted-name guard missing: ' + JSON.stringify(s.state.ui.notices));
        if (s.state.authoring.doc.columns['c.d']) throw new Error('adding a dotted-name column should have been blocked');
    }""")

    # v1.4.0 comparison-flow (§15.8): the per-column ToleranceSpec editor. Build a
    # comparison config with a numeric column whose produced/expected values differ within
    # an absolute tolerance; drive the tolerance editor via the real DOM (form selector +
    # inputs), run compare, and assert a toleranceMatch cell appears in the diff. Then switch
    # the same field to the {percent, of} form and assert the ACTIVE config JSON updates.
    page.evaluate("""async () => {
        const s = window.__tvconsole;
        s.dispatch.mutate((d) => {
            d.meta = { schemaVersion: '1.0.0', name: 'tol-drive' };
            // pasted CSV cells are strings; strictType:false lets them interpret as int/float
            // (mirrors an inference-driven config, whose numeric columns parse string cells)
            d.evaluation = { strictType: false };
            d.columns = { id: { type: { name: 'int' } }, amount: { type: { name: 'float' } } };
            delete d.comparison; delete d.compositeKeys; delete d.customRowChecks; delete d.customTableChecks;
        });
        s.dispatch.toggleComparison(true);
        s.dispatch.edit('comparison.match.keys', ['id']);
        s.dispatch.pasteText('produced', 'id,amount\\n1,10.02\\n2,20.05\\n');
        await s.dispatch.ingest('produced');
        s.dispatch.pasteText('expected', 'id,amount\\n1,10.00\\n2,20.00\\n');
        await s.dispatch.ingest('expected');
        if (s.state.data.produced.status !== 'ready' || s.state.data.expected.status !== 'ready') {
            throw new Error('compare ingest failed: ' + JSON.stringify([s.state.data.produced.error, s.state.data.expected.error]));
        }
        if (!s.state.authoring.lastValidation.valid) throw new Error('tolerance-drive config not authoring-valid: ' + JSON.stringify(s.state.authoring.lastValidation.errors));
        s.dispatch.setTab('comparison');
    }""")
    page.wait_for_timeout(150)
    # absolute form via the DOM (the 'amount' row's tolerance editor: form selector + input)
    amount_row = page.locator("tr", has_text="amount")
    amount_row.locator(".tol-editor select").first.select_option("absolute")
    page.wait_for_timeout(100)
    amount_row.locator(".tol-editor input").first.fill("0.1")
    amount_row.locator(".tol-editor input").first.dispatch_event("change")
    page.wait_for_timeout(100)
    page.evaluate("""async () => {
        const s = window.__tvconsole;
        const t = s.state.authoring.doc.comparison.fields.amount.tolerance;
        if (t !== 0.1) throw new Error('absolute tolerance not committed via the editor: ' + JSON.stringify(s.state.authoring.doc.comparison.fields));
        await s.dispatch.run('compare');
        if (s.state.run.status !== 'done') throw new Error('compare run failed: ' + JSON.stringify(s.state.run.error));
        const rows = s.state.run.result.diff.rows;
        const seen = rows.map((r) => r.cells && r.cells.amount && r.cells.amount.tier);
        if (!seen.includes('toleranceMatch')) throw new Error('expected a toleranceMatch cell in the diff, saw ' + JSON.stringify(seen));
        s.dispatch.setTab('comparison');
    }""")
    page.wait_for_timeout(150)
    # switch the same field to the {percent, of} form and set the percent via the DOM
    amount_row.locator(".tol-editor select").first.select_option("percent")
    page.wait_for_timeout(100)
    amount_row.locator(".tol-editor input").first.fill("0.5")
    amount_row.locator(".tol-editor input").first.dispatch_event("change")
    page.wait_for_timeout(100)
    page.evaluate("""() => {
        const s = window.__tvconsole;
        const t = s.state.authoring.doc.comparison.fields.amount.tolerance;
        if (!t || typeof t !== 'object' || t.percent !== 0.5 || typeof t.of !== 'string') {
            throw new Error('{percent, of} form did not round-trip into the active config: ' + JSON.stringify(t));
        }
    }""")

    page.wait_for_timeout(200)
    browser.close()

fatal = [e for e in errors if "favicon" not in e]
if fatal:
    print("CONSOLE ERRORS:")
    for e in fatal: print(" -", e)
    sys.exit(1)
print(f"console drive OK ({browser_name})")
