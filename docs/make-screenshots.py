"""Screenshot generator for docs/user-guide.md (internal tooling, like test/e2e/).

Serves the repo over http, drives console.html through the same store handle the
E2E drives use (window.__tvconsole) plus real UI interaction where the screenshot
shows interaction, and captures every image in docs/img/ from the committed
example files in docs/examples/. Deterministic: pinned referenceInstant, fixed
1280x800 viewport, UTC timezone, fresh browser profile. It also writes
docs/examples/orders-config.json (the finished config, exported from the console
builder so it round-trips) and asserts every fact the guide claims.

Every image in docs/img/ is produced by this script — regenerate after any UI
change with:  uv run --with playwright python docs/make-screenshots.py
(requires Playwright browsers: `playwright install chromium`)
"""
import functools
import json
import pathlib
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parents[1]
IMG = REPO / "docs" / "img"
EXAMPLES = REPO / "docs" / "examples"
RAW = EXAMPLES / "orders-raw.csv"
EXPECTED = EXAMPLES / "orders-expected.csv"
CONFIG_OUT = EXAMPLES / "orders-config.json"
REF_INSTANT = "2026-07-11T00:00:00Z"

facts = {}
errors = []


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass


def main():
    IMG.mkdir(parents=True, exist_ok=True)
    for old in IMG.glob("*.png"):
        old.unlink()

    handler = functools.partial(Quiet, directory=str(REPO))
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            timezone_id="UTC", locale="en-US",
        )
        page = context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{port}/console.html", wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__tvconsole", timeout=60000)

        # ---------- helpers ----------
        def js(code, arg=None):
            return page.evaluate(code, arg)

        def settle(ms=250):
            page.wait_for_timeout(ms)

        def clean_notices():
            js("() => { const s = window.__tvconsole; while (s.state.ui.notices.length) s.dispatch.dismissNotice(0); }")
            settle(150)

        def shot(locator, name):
            locator.screenshot(path=str(IMG / name), animations="disabled")
            print(f"  [img] {name}")

        def shot_union(locators, name):
            boxes = [loc.bounding_box() for loc in locators]
            x0 = min(b["x"] for b in boxes)
            y0 = min(b["y"] for b in boxes)
            x1 = max(b["x"] + b["width"] for b in boxes)
            y1 = max(b["y"] + b["height"] for b in boxes)
            page.screenshot(path=str(IMG / name), animations="disabled",
                            clip={"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0})
            print(f"  [img] {name}")

        def check(cond, msg):
            if not cond:
                raise AssertionError(f"guide fact-check failed: {msg}")

        def state(expr):
            return js(f"() => {expr.replace('S.', 'window.__tvconsole.state.')}") if "S." in expr \
                else js(f"() => window.__tvconsole.state.{expr}")

        def cards():
            return page.locator("section > .card")

        def upload(slot_index, path, confirm_replace=False):
            cards().nth(slot_index).locator("input[type=file]").set_input_files(str(path))
            settle()
            if confirm_replace:
                page.locator(".dialog button.primary").click()
                settle()

        def fill_commit(locator, value):
            locator.fill(value)
            locator.blur()
            settle(150)

        # pin the determinism affordance for every run
        js(f"() => window.__tvconsole.dispatch.setReferenceInstant('{REF_INSTANT}')")
        settle()

        # ================= ch2: annotated overview (fresh workspace) =================
        print("[ch2] overview")
        js("""() => {
            const mk = (el, label, color) => {
                const r = el.getBoundingClientRect();
                const box = document.createElement('div');
                box.className = '__anno';
                box.style.cssText = 'position:fixed;left:' + (r.left - 4) + 'px;top:' + (r.top - 3) + 'px;width:'
                    + (r.width + 8) + 'px;height:' + (r.height + 6) + 'px;border:2px solid ' + color
                    + ';border-radius:6px;z-index:40;pointer-events:none;';
                const tag = document.createElement('div');
                tag.textContent = label;
                tag.style.cssText = 'position:absolute;right:8px;top:-1px;background:' + color
                    + ';color:#111;font:bold 12px ui-monospace,Consolas,monospace;padding:1px 8px;border-radius:0 0 4px 4px;';
                box.appendChild(tag);
                document.body.appendChild(box);
            };
            mk(document.querySelector('header'), 'header: config library · undo/redo · workspace export/import', '#4ea1ff');
            mk(document.querySelector('nav'), 'readiness rail: the four stages and their status', '#e8c264');
            mk(document.querySelector('section'), 'active stage panel (here: \\u2460 Data)', '#7be08a');
        }""")
        settle(150)
        shot(page.locator("#app"), "02-overview.png")
        js("() => document.querySelectorAll('.__anno').forEach((e) => e.remove())")

        # ================= ch3: fast path on the raw file =================
        print("[ch3] fast path")
        upload(0, RAW)
        prod = cards().nth(0)
        fill_commit(prod.get_by_label("skip leading rows"), "2")
        fill_commit(prod.get_by_label("skip footer rows"), "1")
        shot(prod, "03-ingest-form.png")
        prod.get_by_role("button", name="Ingest").click()
        page.wait_for_function("() => window.__tvconsole.state.data.produced.status === 'ready'")
        settle()
        prov = state("data.produced.provenance")
        check(prov["rowCount"] == 15 and prov["columnCount"] == 5, f"raw provenance: {prov}")
        check(prov["skippedRows"] == 2 and prov["skippedFooterRows"] == 1, f"skip counts: {prov}")
        facts["rawProvenance"] = prov
        facts["rawWarnings"] = state("data.produced.warnings")
        shot(prod, "03-provenance.png")

        infer_card = page.locator("section > .card", has_text="Inference")
        infer_card.get_by_role("button", name="Infer draft config").click()
        settle()
        offer = state("inference.offer")
        cols = {c["name"]: c for c in offer["report"]["columns"]}
        check(cols["order_id"]["inferredType"] == "int", f"order_id inferred {cols['order_id']['inferredType']}")
        check(cols["amount"]["inferredType"] == "string", "messy amount should infer string")
        check(cols["order_date"]["inferredType"] == "string", "mixed-date column should fall back to string")
        check(offer["draft"]["nullHandling"]["nullEquivalents"] == ["", "NA"], "NA not adopted")
        check(offer["report"]["candidateKeys"] == [], "duplicate 1005 should kill the candidate key")
        facts["rawInferReport"] = offer["report"]
        shot(infer_card, "03-infer-offer.png")

        infer_card.get_by_role("button", name="Use draft").click()
        settle()
        clean_notices()
        js("() => window.__tvconsole.dispatch.edit('meta.name', 'orders')")
        settle()
        js("() => window.__tvconsole.dispatch.setTab('run')")
        settle()
        page.get_by_role("button", name="▶ Validate").click()
        page.wait_for_function("() => window.__tvconsole.state.run.status === 'done'")
        settle()
        rep1 = state("run.report")
        check(rep1["verdict"] == "pass", f"fast-path verdict: {rep1['verdict']}")
        check(state("run.viaWorker") is True, "http runs must go through the worker")
        facts["run1"] = {"verdict": rep1["verdict"], "rows": rep1["rowsChecked"], "cols": rep1["columnsChecked"]}
        shot(page.locator(".card.results"), "03-first-verdict.png")

        # ================= ch9a: inference options — allAcceptingFormats =================
        print("[ch9] allAcceptingFormats")
        js("() => window.__tvconsole.dispatch.setTab('data')")
        settle()
        infer_card = page.locator("section > .card", has_text="Inference")
        infer_card.get_by_label("all accepting formats").check()
        settle()
        infer_card.get_by_role("button", name="Re-infer (replaces the draft)").click()
        settle()
        offer = state("inference.offer")
        day = next(c for c in offer["report"]["columns"] if c["name"] == "order_date")
        check(day["inferredType"] == "date", f"allAcceptingFormats: order_date inferred {day['inferredType']}")
        day_formats = offer["draft"]["columns"]["order_date"]["type"]["formats"]
        check(len(day_formats) >= 2, f"union formats missing: {day_formats}")
        facts["unionFormats"] = day_formats
        facts["unionConfidence"] = {"confidence": day["confidence"], "reasons": day["reasons"]}
        shot(infer_card, "09-infer-options.png")
        infer_card.get_by_role("button", name="Use draft").click()
        settle()
        page.locator(".dialog button.primary").click()   # replaces the current columns — confirm
        settle()
        clean_notices()
        js("""() => {
            const d = window.__tvconsole.dispatch;
            d.setInferOption('allAcceptingFormats', false);
            d.edit('meta.name', 'orders');
        }""")
        settle()

        # ================= ch6: schema tab — tighten the config by hand =================
        print("[ch6] schema editing")
        js("""() => {
            const d = window.__tvconsole.dispatch;
            d.edit('columns.order_date.type.formats', ['yyyy-MM-dd']);        // the supplier promised ISO dates
            d.edit('columns.order_date.severity', { byRule: { typeMismatch: 'warning' } });
            d.edit('columns.order_id.unique.enabled', true);                  // ids must be unique
            d.edit('columns.region.nullable', false);                         // region must be filled
            d.setTab('schema');
            d.selectSchema('_columns', 'order_date');
        }""")
        settle()
        clean_notices()
        shot(page.locator("#app"), "06-schema-tab.png")
        detail_card = page.locator(".detail > .card").first
        shot(detail_card, "06-column-editor.png")
        shot(detail_card.locator("details.byrule"), "06-byrule.png")

        # a deliberate mistake: empty formats list → live authoring error
        js("() => window.__tvconsole.dispatch.edit('columns.order_date.type.formats', [])")
        settle()
        v = state("authoring.lastValidation")
        check(v["valid"] is False and any("formats" in e["path"] for e in v["errors"]),
              f"expected a formats authoring error, got {v}")
        facts["authoringError"] = v["errors"][0]
        shot(page.locator(".card.authoring"), "06-authoring-error.png")
        js("() => window.__tvconsole.dispatch.undo()")
        settle()
        check(state("authoring.lastValidation")["valid"] is True, "undo did not clear the mistake")

        # ================= ch4: run the tightened contract on the raw feed =================
        print("[ch4] reading results")
        js("() => window.__tvconsole.dispatch.setTab('run')")
        settle()
        run_card = cards().nth(0)
        run_card.get_by_label("Annotated XLSX", exact=False).check()
        settle()
        ref_field = run_card.get_by_placeholder("e.g. 2026-07-11T00:00:00Z", exact=False)
        fill_commit(ref_field, REF_INSTANT)
        facts["flagLine"] = run_card.locator(".hint").first.inner_text()
        shot(run_card, "04-run-outputs.png")
        page.get_by_role("button", name="▶ Validate").click()
        page.wait_for_function("() => window.__tvconsole.state.run.status === 'done'")
        settle()
        rep2 = state("run.report")
        check(rep2["verdict"] == "fail", f"tightened raw verdict: {rep2['verdict']}")
        check(rep2["bySeverity"] == {"error": 11, "warning": 4}, f"raw counts: {rep2['bySeverity']}")
        facts["run2"] = rep2
        js("() => window.__tvconsole.dispatch.setResultView('report')")
        settle()
        shot(page.locator(".card.results"), "04-report-fail.png")
        shot(page.locator(".verdict"), "05-verdict-raw.png")
        js("() => window.__tvconsole.dispatch.setResultView('errors')")
        settle()
        shot(page.locator(".result-body"), "04-errors-view.png")
        js("() => window.__tvconsole.dispatch.setResultView('data')")
        settle()
        check(state("run.result").get("cellObservations") is not None, "observations not collected")
        shot(page.locator(".result-body"), "04-data-view.png")
        facts["run2messages"] = [d["message"] for d in state("run.result")["summary"]["details"]]

        # ================= ch5: re-ingest with normalization =================
        print("[ch5] normalization")
        js("() => window.__tvconsole.dispatch.setTab('data')")
        settle()
        upload(0, RAW, confirm_replace=True)
        prod = cards().nth(0)
        fill_commit(prod.get_by_label("skip leading rows"), "2")
        fill_commit(prod.get_by_label("skip footer rows"), "1")
        js("""() => window.__tvconsole.dispatch.mutateIngestForm('produced', (f) => {
            f.norm.table.push({ fn: 'trim', params: '' });
            f.norm.columns.push({ key: 'amount', steps: [
                { fn: 'stripAffix', params: '{"prefixes":["$"]}' },
                { fn: 'nullCoerce', params: '{"equivalents":["NA"]}' },
                { fn: 'reformatNumber', params: '{"format":{"decimalSeparator":".","groupingSeparators":[","]}}' },
            ]});
            f.norm.columns.push({ key: 'order_date', steps: [
                { fn: 'reformatTemporal', params: '{"from":["dd.MM.yyyy"],"to":"yyyy-MM-dd"}' },
            ]});
            f.norm.columns.push({ key: 'status', steps: [
                { fn: 'nullCoerce', params: '{"equivalents":["NA"]}' },
            ]});
            f.norm.columns.push({ key: 'region', steps: [{ fn: 'fillDown', params: '' }] });
        })""")
        settle()
        shot(prod.locator("details.norm-editor"), "05-norm-editor.png")
        prod.get_by_role("button", name="Ingest").click()
        page.wait_for_function("() => window.__tvconsole.state.data.produced.status === 'ready'")
        settle()
        table = state("data.produced.table")
        check(table["rows"][0][2] == "1200.50", f"amount not cleaned: {table['rows'][0]}")
        check(table["rows"][3][3] == "2026-07-02", f"date not reformatted: {table['rows'][3]}")
        check(table["rows"][1][1] == "North", f"region not filled down: {table['rows'][1]}")
        check(table["rows"][4][4] is None, f"status NA not coerced: {table['rows'][4]}")
        acts = state("data.produced.normalizationActions")
        facts["normalizationActions"] = acts
        facts["normProvenanceLine"] = prod.locator(".prov").inner_text()
        shot(prod, "05-norm-provenance.png")

        # the run is now stale (data replaced) — the ch8 banner
        js("() => window.__tvconsole.dispatch.setTab('run')")
        settle()
        stale = page.locator(".notice.warn", has_text="stale")
        facts["staleBanner"] = stale.inner_text()
        shot(stale, "08-stale-banner.png")

        # re-infer on the cleaned table, accept, tighten the same one constraint
        js("() => window.__tvconsole.dispatch.setTab('data')")
        settle()
        infer_card = page.locator("section > .card", has_text="Inference")
        infer_card.get_by_role("button", name="Re-infer (replaces the draft)").click()
        settle()
        offer = state("inference.offer")
        cols = {c["name"]: c for c in offer["report"]["columns"]}
        check(cols["amount"]["inferredType"] == "float", f"clean amount inferred {cols['amount']['inferredType']}")
        check(cols["order_date"]["inferredType"] == "date", "clean order_date should infer date")
        check(offer["draft"]["columns"]["region"]["nullable"] is False, "region should be non-nullable after fillDown")
        facts["cleanInferReport"] = offer["report"]
        infer_card.get_by_role("button", name="Use draft").click()
        settle()
        page.locator(".dialog button.primary").click()
        settle()
        clean_notices()
        js("""() => {
            const d = window.__tvconsole.dispatch;
            d.edit('meta.name', 'orders');
            d.edit('columns.order_id.unique.enabled', true);
        }""")
        settle()
        js("() => window.__tvconsole.dispatch.setTab('run')")
        settle()
        page.get_by_role("button", name="▶ Validate").click()
        page.wait_for_function("() => window.__tvconsole.state.run.status === 'done'")
        settle()
        rep3 = state("run.report")
        check(rep3["verdict"] == "fail" and rep3["bySeverity"] == {"error": 2, "warning": 0},
              f"clean verdict: {rep3['verdict']} {rep3['bySeverity']}")
        facts["run3"] = rep3
        check(state("ui.resultView") == "delta", "delta should be the default view after a re-run")
        delta_body = page.locator(".result-body").inner_text()
        check("13 resolved" in delta_body and "2 unchanged" in delta_body and "0 new" in delta_body,
              f"raw→clean delta wrong: {delta_body[:200]}")
        facts["deltaRawToClean"] = "0 new · 13 resolved · 2 unchanged"
        js("() => window.__tvconsole.dispatch.setResultView('report')")
        settle()
        shot(page.locator(".verdict"), "05-verdict-clean.png")

        # ================= ch8: iterate — one setting, re-run, Δ =================
        print("[ch8] iterate + delta")
        js("() => window.__tvconsole.dispatch.edit('columns.order_id.severity', { byRule: { uniquenessViolation: 'warning' } })")
        settle()
        check(state("run.stale") is True, "config edit should mark the result stale")
        page.locator(".notice.warn", has_text="stale").get_by_role("button", name="Re-run validate").click()
        page.wait_for_function("() => window.__tvconsole.state.run.status === 'done'")
        settle()
        rep4 = state("run.report")
        check(rep4["verdict"] == "passWithWarnings", f"severity iteration verdict: {rep4['verdict']}")
        check(state("ui.resultView") == "delta", "delta not default after the iteration re-run")
        facts["run4"] = rep4
        delta_body = page.locator(".result-body").inner_text()
        check("fail → passWithWarnings" in delta_body, f"verdict movement missing: {delta_body[:200]}")
        shot(page.locator(".card.results"), "08-delta.png")
        js("() => window.__tvconsole.dispatch.undo()")   # keep the duplicate an error
        settle()

        # ================= ch7: comparison =================
        print("[ch7] comparison")
        js("() => window.__tvconsole.dispatch.setTab('comparison')")
        settle()
        cards().nth(0).get_by_label("Comparison enabled").check()
        settle()
        check(state("authoring.doc")["comparison"]["match"]["keys"] == ["order_id"],
              "toggle should seed match.keys with the first column")
        js("() => window.__tvconsole.dispatch.edit('comparison.match.onDuplicateKey', 'reportAndExclude')")
        settle()
        perfield = cards().nth(2)
        amount_row = perfield.locator("tr", has_text="amount")
        fill_commit(amount_row.get_by_placeholder("(same header)"), "Betrag")
        # the ToleranceSpec editor (§15.8) is a form selector + the chosen form's inputs;
        # pick the absolute form, then enter the cent tolerance
        amount_row.locator(".tol-editor select").first.select_option("absolute")
        settle(150)
        fill_commit(amount_row.get_by_placeholder("ε ≥ 0"), "0.01")
        doc = state("authoring.doc")
        check(doc["comparison"]["fields"]["amount"] == {"expectedName": "Betrag", "tolerance": 0.01},
              f"per-field edits: {doc['comparison'].get('fields')}")
        shot_union([cards().nth(0), cards().nth(1)], "07-comparison-match.png")
        shot(perfield, "07-perfield.png")

        # ch9: one-click adoption — with comparison on, the tolerance button is live
        js("() => window.__tvconsole.dispatch.setTab('data')")
        settle()
        infer_card = page.locator("section > .card", has_text="Inference")
        infer_card.get_by_role("button", name="Re-infer (replaces the draft)").click()
        settle()
        tol = state("inference.offer")["report"]["suggestions"]["tolerances"]
        check(tol and tol[0]["column"] == "amount", f"tolerance suggestion missing: {tol}")
        facts["toleranceSuggestion"] = tol[0]
        shot(infer_card.locator(".offer"), "09-adoption.png")
        infer_card.get_by_role("button", name="Dismiss").click()
        settle()

        # expected table
        upload(1, EXPECTED)
        exp = cards().nth(1)
        exp.get_by_role("button", name="Ingest").click()
        page.wait_for_function("() => window.__tvconsole.state.data.expected.status === 'ready'")
        settle()
        prov = state("data.expected.provenance")
        check(prov["rowCount"] == 15 and prov["columnCount"] == 5, f"expected provenance: {prov}")

        js("() => window.__tvconsole.dispatch.setTab('run')")
        settle()
        page.get_by_role("button", name="▶ Compare").click()
        page.wait_for_function("() => window.__tvconsole.state.run.status === 'done'")
        settle()
        rep5 = state("run.report")
        facts["run5"] = rep5
        check(rep5["verdict"] == "fail", f"compare verdict: {rep5['verdict']}")
        diff = state("run.result")["diff"]
        statuses = {}
        for r in diff["rows"]:
            statuses[r["status"]] = statuses.get(r["status"], 0) + 1
        facts["diffStatuses"] = statuses
        check(statuses.get("missing") == 1, f"expected one missing row (1015): {statuses}")
        check(statuses.get("excludedDuplicateKey", 0) >= 2, f"1005 rows not excluded: {statuses}")
        tiers = {}
        for r in diff["rows"]:
            for cd in r["cells"].values():
                if cd:
                    tiers[cd["tier"]] = tiers.get(cd["tier"], 0) + 1
        facts["cellTiers"] = tiers
        check(tiers.get("toleranceMatch") == 1, f"340.004 should tolerance-match: {tiers}")
        check(tiers.get("valueMismatch") == 1, f"25.75 should value-mismatch: {tiers}")
        js("() => window.__tvconsole.dispatch.setResultView('diff')")
        settle()
        shot(page.locator(".card.results"), "07-diff-grid.png")
        js("""() => {
            const d = window.__tvconsole.dispatch;
            d.setResultView('errors');
            d.setFilter('matchStatus', 'missing');
        }""")
        settle()
        shot(page.locator(".result-body"), "07-errors-matchstatus.png")
        js("() => window.__tvconsole.dispatch.setFilter('matchStatus', '')")
        settle()

        # ---- export the finished config exactly as the console downloads it
        cfg_json = js("() => JSON.stringify(window.__tvconsole.state.authoring.doc, null, 2)")
        round_trip = js("""(cfg) => {
            const rebuilt = TableValidation.createConfigBuilder(JSON.parse(cfg)).build();
            return JSON.stringify(rebuilt, null, 2) === cfg;
        }""", cfg_json)
        check(round_trip, "orders-config.json does not round-trip through the builder")
        CONFIG_OUT.write_text(cfg_json + "\n", encoding="utf-8", newline="\n")
        print(f"  [cfg] {CONFIG_OUT.name} written (round-trips)")
        js("() => window.__tvconsole.dispatch.configSave()")
        settle()
        clean_notices()

        # ================= ch9: message templates =================
        print("[ch9] messageTemplates, paste, advanced, workspace")
        run_card = cards().nth(0)
        tpl = '{"uniquenessViolation": "Duplicate order id - every order must appear exactly once"}'
        tpl_field = run_card.get_by_placeholder('{"typeMismatch"', exact=False)
        fill_commit(tpl_field, tpl)
        shot(run_card.locator(".field", has_text="messageTemplates"), "09-templates-field.png")
        page.get_by_role("button", name="▶ Validate").click()
        page.wait_for_function("() => window.__tvconsole.state.run.status === 'done'")
        settle()
        msgs = [d["message"] for d in state("run.result")["summary"]["details"]]
        check(any("Duplicate order id" in m for m in msgs), f"template not applied: {msgs}")
        facts["templatedMessage"] = [m for m in msgs if "Duplicate order id" in m][0]
        js("() => window.__tvconsole.dispatch.setResultView('summary')")
        settle()
        shot(page.locator(".result-body"), "09-templates-result.png")
        fill_commit(cards().nth(0).get_by_placeholder('{"typeMismatch"', exact=False), "")

        # paste-data affordance (shown, not committed)
        js("() => window.__tvconsole.dispatch.setTab('data')")
        settle()
        prod = cards().nth(0)
        prod.get_by_text("Paste data instead of a file").click()
        settle(150)
        prod.locator("textarea").fill("order_id,region,amount\n2001,North,10.50\n2002,South,20.00")
        settle(150)
        shot(prod, "09-paste.png")
        prod.get_by_text("Paste data instead of a file").click()   # collapse again
        settle(150)

        # advanced mode (per-session custom functions)
        js("() => window.__tvconsole.dispatch.setTab('run')")
        settle()
        adv_card = page.locator("section > .card", has_text="Advanced mode")
        facts["advancedWarning"] = adv_card.locator(".notice.warn").inner_text()
        adv_card.get_by_label("enable advanced mode for this session").check()
        settle()
        fill_commit(adv_card.get_by_placeholder("e.g. myCheck"), "amountPositive")
        fill_commit(adv_card.locator("textarea"),
                    '(row, interpreted, i, p) => interpreted.amount !== null && interpreted.amount <= 0'
                    ' ? [{ field: "amount", pass: false, message: "amount must be positive" }] : []')
        shot(adv_card, "09-advanced.png")
        adv_card.get_by_label("enable advanced mode for this session").uncheck()
        settle()

        # workspace round-trip: everything but the table data
        ws = js("() => window.__tvconsole.dispatch.workspaceExportJson()")
        bundle = json.loads(ws)
        check(bundle["tvconsoleWorkspace"] == 1 and bundle["referenceInstant"] == REF_INSTANT,
              "workspace bundle incomplete")
        check("1200.50" not in ws, "workspace must not embed table data")
        facts["workspaceKeys"] = sorted(bundle.keys())
        js("(t) => window.__tvconsole.dispatch.workspaceImport(t, 'orders-workspace.json')", ws)
        settle()
        clean_notices()
        js("() => window.__tvconsole.dispatch.setTab('data')")
        settle()
        prod = cards().nth(0)
        check(state("data.produced.status") == "empty" and state("data.produced.stub") is not None,
              "workspace import should leave a re-upload stub")
        facts["stubLine"] = prod.locator(".hint", has_text="Previous session").inner_text()
        shot(prod, "09-workspace.png")

        # ================= ch10: a canonical ingestion error =================
        print("[ch10] ingest error")
        upload(0, RAW)
        prod = cards().nth(0)
        prod.get_by_label("format").select_option("xlsx")
        settle()
        prod.get_by_role("button", name="Ingest").click()
        page.wait_for_function("() => window.__tvconsole.state.data.produced.status === 'failed'")
        settle()
        err = state("data.produced.error")
        check(err["code"] == "formatMismatch", f"expected formatMismatch, got {err}")
        facts["ingestError"] = {"code": err["code"], "message": err["message"]}
        shot(prod, "10-ingest-error.png")

        # ============ ch9: number formats — the from-example compiler + a pattern/negativeStyle form ============
        # `amount` is a float column (from the ch5 clean re-infer), so its type block carries a
        # NumberFormat[] `formats` field with the example-to-format compiler beside it.
        print("[ch9] number formats: compiler + pattern/negativeStyle form")
        js("""() => {
            const d = window.__tvconsole.dispatch;
            d.setTab('schema');
            d.selectSchema('_columns', 'amount');
        }""")
        settle()
        clean_notices()
        detail = page.locator(".detail > .card").first
        fmt_field = detail.locator("div.field:has(.fmt-example)")
        check(fmt_field.count() >= 1, "float column editor has no NumberFormat formats field")
        # example → format: typing a sample compiles it to an append button (nothing silent)
        example_input = fmt_field.locator(".fmt-example input")
        example_input.fill("(1 234,50)")
        settle(200)
        chip = fmt_field.locator(".fmt-example button.mini")
        check(chip.count() >= 1, "example compiler produced no compiled-format button")
        facts["compiledExample"] = chip.first.inner_text()
        shot(fmt_field, "09-compiler.png")
        example_input.fill("")
        settle(100)
        # a pattern + negativeStyle-bearing NumberFormat, shown in the formats field
        js("""() => window.__tvconsole.dispatch.edit('columns.amount.type.formats',
            [{ decimalSeparator: '.', groupingSeparators: [','], negativeStyle: 'parentheses', pattern: '#,##0.00' }])""")
        settle()
        v = state("authoring.lastValidation")
        check(v["valid"] is True, f"pattern/negativeStyle format should author clean, got {v}")
        shot(detail, "09-numberformat.png")

        # ============ ch7: the ToleranceSpec editor (§15.8) — a non-absolute form ============
        # comparison is on (from the ch7 flow, carried through the workspace import); show the
        # per-row/percent selector rather than the plain absolute number.
        print("[ch7] tolerance editor")
        js("""() => {
            const d = window.__tvconsole.dispatch;
            d.setTab('comparison');
            d.edit('comparison.fields.amount.tolerance', { percent: 0.5, of: 'amount' });
        }""")
        settle()
        perfield = cards().nth(2)
        amount_row = perfield.locator("tr", has_text="amount")
        tol = amount_row.locator(".tol-editor")
        check(tol.count() >= 1, "tolerance editor cell not rendered for the numeric column")
        shot(tol, "07-tolerance-editor.png")

        browser.close()
    srv.shutdown()

    fatal = [e for e in errors if "favicon" not in e]
    if fatal:
        print("PAGE ERRORS:")
        for e in fatal:
            print(" -", e)
        sys.exit(1)

    total = sum(f.stat().st_size for f in IMG.glob("*.png"))
    print(f"\n{len(list(IMG.glob('*.png')))} images, total {total / 1024:.0f} KiB")
    print("\nFACTS (for the guide):")
    print(json.dumps(facts, indent=2, default=str))


if __name__ == "__main__":
    main()
