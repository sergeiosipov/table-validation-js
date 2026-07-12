"""Headless drive of batch-infer-standalone.html (file://): multi-file pick with a
mixed bag (clean CSV, JSON records, unsupported extension, corrupt XLSX), infer all,
verify per-file outcomes, download the ZIP and validate its contents (configs parse,
are authoring-valid drafts, manifest names every input incl. failures); then the
folder picker over docs/examples. The page loads its engine from the pinned CDN tag,
so this drive needs network. Usage: drive_batch_infer.py [chromium|firefox|webkit]"""
import io
import json
import pathlib
import sys
import tempfile
import zipfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

repo = pathlib.Path(__file__).resolve().parents[2]
url = (repo / "batch-infer-standalone.html").as_uri()
browser_name = sys.argv[1] if len(sys.argv) > 1 else "chromium"
errors = []

# ---- build a controlled input set in a temp dir
tmp = pathlib.Path(tempfile.mkdtemp(prefix="tv-batch-"))
(tmp / "clean.csv").write_text(
    "id,region,amount,day\n1,North,10.50,2026-07-01\n2,South,20.00,2026-07-02\n3,East,30.25,2026-07-03\n",
    encoding="utf-8")
(tmp / "records.json").write_text(
    '[{"sku":"A-1","qty":5},{"sku":"A-2","qty":7},{"sku":"A-3","qty":null}]', encoding="utf-8")
(tmp / "notes.md").write_text("# not a table\n", encoding="utf-8")
(tmp / "broken.xlsx").write_bytes(b"this is not a zip container")

with sync_playwright() as p:
    browser = getattr(p, browser_name).launch()
    page = browser.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    cdn_engine = []
    page.on("request", lambda r: cdn_engine.append(r.url)
            if "cdn.jsdelivr.net" in r.url and "table-validation.js" in r.url else None)
    page.goto(url)
    page.wait_for_function("() => !!window.__tvbatch", timeout=60000)
    assert cdn_engine, "engine was not fetched from the pinned CDN tag"
    assert "v1.1.0" in page.inner_text("#ver"), "engine version banner missing"

    # ---- multi-file pick: mixed outcomes
    page.set_input_files("#inFiles", [str(tmp / n) for n in
                                      ["clean.csv", "records.json", "notes.md", "broken.xlsx"]])
    page.wait_for_timeout(200)
    page.click("#run")
    page.wait_for_function("() => document.getElementById('progress').textContent.startsWith('done')",
                           timeout=60000)
    st = {e["relPath"]: e["status"] for e in page.evaluate(
        "() => window.__tvbatch.entries().map((e) => ({relPath: e.relPath, status: e.status}))")}
    assert st == {"broken.xlsx": "failed", "clean.csv": "ok", "notes.md": "unsupported",
                  "records.json": "ok"}, f"statuses: {st}"
    body = page.inner_text("#rows")
    assert "authoring-valid" in body and "formatMismatch" in body and "skipped" in body, body[:300]
    # records.json must have gone through the jsonObjects path (records → intrinsic headers)
    draft = page.evaluate("() => window.__tvbatch.entries().find((e) => e.relPath === 'records.json').draft")
    assert set(draft["columns"]) == {"sku", "qty"}, f"jsonObjects columns: {list(draft['columns'])}"
    assert draft["meta"]["name"] == "records", f"meta.name: {draft['meta']['name']}"

    # ---- the ZIP: configs + reports + manifest, failures included
    with page.expect_download() as dl:
        page.click("#zip")
    zpath = tmp / "out.zip"
    dl.value.save_as(str(zpath))
    z = zipfile.ZipFile(zpath)
    names = sorted(z.namelist())
    assert names == ["clean.config.json", "clean.report.json", "manifest.json",
                     "records.config.json", "records.report.json"], f"zip contents: {names}"
    for n in ("clean.config.json", "records.config.json"):
        cfg = json.loads(z.read(n))
        assert cfg["meta"]["schemaVersion"] == "1.1.0" and cfg["columns"], f"{n} malformed"
    manifest = json.loads(z.read("manifest.json"))
    mstat = {f["file"]: f["status"] for f in manifest["files"]}
    assert mstat == st, f"manifest disagrees with the UI: {mstat}"
    assert manifest["files"] and manifest["engineVersion"] == "1.1.0"
    failed = next(f for f in manifest["files"] if f["file"] == "broken.xlsx")
    assert failed["error"]["code"] == "formatMismatch", f"manifest error detail: {failed}"
    print(f"[{browser_name}] files mode: 2 inferred, 1 failed, 1 skipped; ZIP verified "
          f"({len(names)} entries, manifest complete)")

    # ---- the combined XLSX: one sheet per inferred file, inferred metadata above the data
    with page.expect_download() as dl:
        page.click("#xlsx")
    xpath = tmp / "workbook.xlsx"
    dl.value.save_as(str(xpath))
    x = zipfile.ZipFile(xpath)
    wbxml = x.read("xl/workbook.xml").decode("utf-8")
    assert 'name="clean"' in wbxml and 'name="records"' in wbxml, f"sheets missing: {wbxml[:300]}"
    assert wbxml.count("<sheet ") == 2, "exactly one sheet per inferred file"
    shared = x.read("xl/sharedStrings.xml").decode("utf-8")
    for needle in ("inferred type", "format", "precision", "nullable", "confidence",
                   "candidate key", "alternatives", "date", "float", "yyyy-MM-dd", "North"):
        assert needle in shared, f"combined XLSX lacks '{needle}' (metadata block or data rows missing)"
    print(f"[{browser_name}] combined XLSX: 2 sheets, metadata block + data present")

    # ---- folder pick over docs/examples: recursion + relative paths + honest failure
    # (orders-config.json is a JSON *object*, not a table — it must fail, not vanish)
    page.set_input_files("#inFolder", str(repo / "docs" / "examples"))
    page.wait_for_timeout(200)
    page.click("#run")
    page.wait_for_function("() => document.getElementById('progress').textContent.startsWith('done')",
                           timeout=60000)
    st2 = {e["relPath"].split("/")[-1]: e["status"] for e in page.evaluate(
        "() => window.__tvbatch.entries().map((e) => ({relPath: e.relPath, status: e.status}))")}
    assert st2["orders-raw.csv"] == "ok" and st2["orders-expected.csv"] == "ok", f"folder statuses: {st2}"
    assert st2["orders-config.json"] == "failed", f"a config JSON is not a table: {st2}"
    rel = page.evaluate("() => window.__tvbatch.entries()[0].relPath")
    assert "/" in rel, f"folder pick should carry relative paths: {rel}"
    print(f"[{browser_name}] folder mode: examples folder → 2 inferred, 1 failed (json object), "
          f"relative paths preserved")

    browser.close()

fatal = [e for e in errors if "favicon" not in e]
if fatal:
    print("PAGE ERRORS:")
    for e in fatal:
        print(" -", e)
    sys.exit(1)
print(f"batch-infer drive OK ({browser_name})")
