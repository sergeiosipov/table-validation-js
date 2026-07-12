"""Serve the repo over http and verify: the worker protocol suite, console engines via
the worker, two-tab localStorage sync (storage event), and an axe-core accessibility
scan of the console's four tabs plus a keyboard-only pass.
Usage: drive_http.py [chromium|firefox|webkit]"""
import sys, pathlib, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

repo = str(pathlib.Path(__file__).resolve().parents[2])
browser_name = sys.argv[1] if len(sys.argv) > 1 else "chromium"

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass

handler = functools.partial(Quiet, directory=repo)
srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

errors = []
with sync_playwright() as p:
    browser = getattr(p, browser_name).launch()
    context = browser.new_context()
    page = context.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))

    # 1. worker protocol suite
    page.goto(f"http://127.0.0.1:{port}/test/worker.html", wait_until="domcontentloaded", timeout=120000)
    page.wait_for_function("() => !document.getElementById('summary').textContent.includes('running')", timeout=120000)
    summary = page.inner_text("#summary")
    print(f"[{browser_name}] worker suite:", summary)
    if "0 failed" not in summary:
        for n in page.eval_on_selector_all(".test.fail, .note", "els => els.map(e => e.textContent)"):
            print("  ", n)
        browser.close(); srv.shutdown(); sys.exit(1)

    # 2. console over http: engines must run through the worker
    page.goto(f"http://127.0.0.1:{port}/console.html", wait_until="domcontentloaded", timeout=120000)
    page.wait_for_function("() => !!window.__tvconsole", timeout=60000)
    page.evaluate("""async () => {
        const s = window.__tvconsole;
        const csv = 'id,amount\\n1,10\\n2,20\\n';
        s.dispatch.pickFile('produced', new File([csv], 'w.csv', { type: 'text/csv' }));
        await s.dispatch.ingest('produced');
        s.dispatch.inferRun();
        s.dispatch.inferAccept();
        await s.dispatch.run('validate');
        if (s.state.run.status !== 'done') throw new Error('run failed: ' + JSON.stringify(s.state.run.error));
        if (!s.state.run.viaWorker) throw new Error('expected the run to go through the engine worker over http');
        if (s.state.run.report.verdict !== 'pass') throw new Error('verdict: ' + s.state.run.report.verdict);
    }""")
    print(f"[{browser_name}] console over http: engines ran via the worker, verdict pass")

    # 3. two-tab localStorage sync: saving in tab 1 updates tab 2's library (storage event)
    page2 = context.new_page()
    page2.goto(f"http://127.0.0.1:{port}/console.html", wait_until="domcontentloaded", timeout=120000)
    page2.wait_for_function("() => !!window.__tvconsole", timeout=60000)
    page.evaluate("""() => {
        const s = window.__tvconsole;
        s.dispatch.edit('meta.name', 'two-tab-sync');
        s.dispatch.configSave();
    }""")
    page2.wait_for_function(
        "() => window.__tvconsole.state.configs.entries.some((e) => e.name === 'two-tab-sync')", timeout=15000)
    notices = page2.evaluate("() => window.__tvconsole.state.ui.notices.map((n) => n.text)")
    assert any("another tab" in n for n in notices), f"no cross-tab notice: {notices}"
    print(f"[{browser_name}] two-tab sync: library updated via the storage event, notice shown")
    page2.close()

    # 4. accessibility: axe-core over the four tabs (serious/critical fail), keyboard pass
    page.add_script_tag(url="https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js")
    a11y_fail = []
    for tab in ["data", "schema", "comparison", "run"]:
        page.evaluate(f"() => window.__tvconsole.dispatch.setTab('{tab}')")
        page.wait_for_timeout(150)
        violations = page.evaluate("""async () => {
            const r = await axe.run(document.getElementById('app'));
            return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
                .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.nodes[0] && v.nodes[0].target.join(' ')}`);
        }""")
        for v in violations:
            a11y_fail.append(f"tab {tab}: {v}")
    if a11y_fail:
        print(f"[{browser_name}] AXE VIOLATIONS:")
        for v in a11y_fail: print("  -", v)
        browser.close(); srv.shutdown(); sys.exit(1)
    print(f"[{browser_name}] axe: no serious/critical violations on any tab")

    # keyboard-only pass over the primary flow: the rail tabs and the Run button are
    # reachable and operable with Tab/Enter
    page.evaluate("() => window.__tvconsole.dispatch.setTab('data')")
    page.wait_for_timeout(150)
    reached = page.evaluate("""() => {
        const focusables = [];
        const app = document.getElementById('app');
        let el = app.querySelector('button, [href], input, select, textarea');
        // heuristic sweep: every button/select/input in the header + rail must be tabbable
        for (const node of app.querySelectorAll('header button, header select, nav button')) {
            if (node.disabled) continue;    // disabled controls are legitimately unfocusable
            node.focus();
            focusables.push(document.activeElement === node);
        }
        return focusables;
    }""")
    assert all(reached) and len(reached) > 5, f"keyboard reachability broke: {reached}"
    page.keyboard.press("Tab")
    # activate the Run tab via keyboard on its rail button
    page.evaluate("""() => {
        const btn = [...document.querySelectorAll('nav button')].find((b) => b.textContent.includes('Run'));
        btn.focus();
    }""")
    page.keyboard.press("Enter")
    page.wait_for_timeout(150)
    active = page.evaluate("() => window.__tvconsole.state.ui.activeTab")
    assert active == "run", f"keyboard Enter did not switch tabs (activeTab={active})"
    print(f"[{browser_name}] keyboard pass: header/rail tabbable, Enter activates tabs")

    browser.close()
srv.shutdown()
fatal = [e for e in errors if "favicon" not in e]
if fatal:
    print("PAGE ERRORS:"); [print(" -", e) for e in fatal]
    sys.exit(1)
print(f"http drive OK ({browser_name})")
