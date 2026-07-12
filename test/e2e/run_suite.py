"""Headless run of the browser conformance suite (test/index.html from file://).
Usage: run_suite.py [chromium|firefox|webkit] [--tz ZONE]
Exit 0 = all pass; 1 = failures; 2 = blocked (CDN dependency missing — fix the env)."""
import sys, pathlib
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

repo = pathlib.Path(__file__).resolve().parents[2]
url = (repo / "test" / "index.html").as_uri()
args = [a for a in sys.argv[1:]]
browser_name = next((a for a in args if not a.startswith("--")), "chromium")
tz = None
if "--tz" in args:
    tz = args[args.index("--tz") + 1]

with sync_playwright() as p:
    browser = getattr(p, browser_name).launch()
    context = browser.new_context(timezone_id=tz) if tz else browser.new_context()
    page = context.new_page()
    page.goto(url)
    page.wait_for_function("() => !document.getElementById('summary').textContent.includes('running')", timeout=300000)
    summary = page.inner_text("#summary")
    print((f"[tz={tz}] " if tz else "") + f"[{browser_name}] " + summary)
    if "0 failed" not in summary:
        for f in page.eval_on_selector_all(".test.fail", "els => els.map(e => e.textContent)"):
            print("FAIL:", f)
        for n in page.eval_on_selector_all(".note", "els => els.map(e => e.textContent)")[:60]:
            print("NOTE:", n)
        browser.close(); sys.exit(1)
    if "0 blocked" not in summary:
        for b in page.eval_on_selector_all(".test.blocked", "els => els.map(e => e.textContent)"):
            print("BLOCKED:", b)
        browser.close(); sys.exit(2)
    browser.close()
