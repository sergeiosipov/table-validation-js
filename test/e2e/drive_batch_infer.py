"""Headless drive of batch-infer-standalone.html (file://): multi-file pick with a
mixed bag (clean CSV, JSON records, unsupported extension, corrupt XLSX), infer all,
verify per-file outcomes, download the ZIP and validate its contents (configs parse,
are authoring-valid drafts, manifest names every input incl. failures); then the
folder picker over docs/examples. The page loads its engine from the pinned CDN tag,
so this drive needs network. Usage: drive_batch_infer.py [chromium|firefox|webkit]"""
import html as _html
import io
import json
import pathlib
import re
import sys
import tempfile
import zipfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright


# ---- minimal OOXML readback (no ExcelJS in Python): resolve a Summary row's
# top-frequency cells (columns past the metadata block) into their string values.
def shared_strings(xml):
    out = []
    for si in re.findall(r"<si>(.*?)</si>", xml, re.S):
        ts = re.findall(r"<t[^>]*>(.*?)</t>", si, re.S)
        out.append(_html.unescape("".join(ts)))
    return out


def _col_to_idx(col):  # 'A' -> 1, 'L' -> 12
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n


def row_topfreq(sheetxml, r, shared, meta_cols):
    m = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % r, sheetxml, re.S)
    if not m:
        return []
    vals = []
    for cm in re.finditer(r'<c r="([A-Z]+)%d"([^>]*)>(.*?)</c>' % r, m.group(1), re.S):
        col, attrs, inner = cm.group(1), cm.group(2), cm.group(3)
        if _col_to_idx(col) <= meta_cols:
            continue
        vm = re.search(r"<v>(.*?)</v>", inner, re.S)
        if not vm:
            continue
        vals.append(shared[int(vm.group(1))] if 't="s"' in attrs else _html.unescape(vm.group(1)))
    return vals

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
# a hidden dotfile must be listed as skipped (never silently dropped) — pins the
# v1.3.1 batch hidden-file rule (B035)
(tmp / ".DS_Store").write_bytes(b"\x00\x00\x00\x00")

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
    assert "v1.4.0" in page.inner_text("#ver"), "engine version banner missing"

    # ---- multi-file pick: mixed outcomes
    page.set_input_files("#inFiles", [str(tmp / n) for n in
                                      ["clean.csv", "records.json", "notes.md", "broken.xlsx", ".DS_Store"]])
    page.wait_for_timeout(200)
    page.click("#run")
    page.wait_for_function("() => document.getElementById('progress').textContent.startsWith('done')",
                           timeout=60000)
    ent = {e["relPath"]: e for e in page.evaluate(
        "() => window.__tvbatch.entries().map((e) => ({relPath: e.relPath, status: e.status, reason: e.reason}))")}
    st = {k: v["status"] for k, v in ent.items()}
    assert st == {".DS_Store": "unsupported", "broken.xlsx": "failed", "clean.csv": "ok",
                  "notes.md": "unsupported", "records.json": "ok"}, f"statuses: {st}"
    # B035: the dotfile is skipped for being hidden — distinct reason from an unsupported
    # extension, and it is listed (never silently dropped)
    assert ent[".DS_Store"]["reason"] == "hidden file (dotfile)", f"dotfile reason: {ent['.DS_Store']['reason']}"
    assert ent["notes.md"]["reason"] == "unsupported extension", f"notes.md reason: {ent['notes.md']['reason']}"
    body = page.inner_text("#rows")
    assert "authoring-valid" in body and "formatMismatch" in body and "skipped" in body, body[:300]
    assert "skipped — hidden file (dotfile)" in body, "hidden-file skip row not rendered"
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
        assert cfg["meta"]["schemaVersion"] == "1.4.0" and cfg["columns"], f"{n} malformed"
    manifest = json.loads(z.read("manifest.json"))
    mstat = {f["file"]: f["status"] for f in manifest["files"]}
    assert mstat == st, f"manifest disagrees with the UI: {mstat}"
    assert manifest["files"] and manifest["engineVersion"] == "1.4.0"
    failed = next(f for f in manifest["files"] if f["file"] == "broken.xlsx")
    assert failed["error"]["code"] == "formatMismatch", f"manifest error detail: {failed}"
    print(f"[{browser_name}] files mode: 2 inferred, 1 failed, 1 skipped; ZIP verified "
          f"({len(names)} entries, manifest complete)")

    # ---- the combined XLSX: Summary sheet first (flat metadata + top-freq values),
    # then one sheet per inferred file with the metadata block above the data
    with page.expect_download() as dl:
        page.click("#xlsx")
    xpath = tmp / "workbook.xlsx"
    dl.value.save_as(str(xpath))
    x = zipfile.ZipFile(xpath)
    wbxml = x.read("xl/workbook.xml").decode("utf-8")
    assert 'name="clean"' in wbxml and 'name="records"' in wbxml, f"sheets missing: {wbxml[:300]}"
    assert wbxml.count("<sheet ") == 3, "Summary + one sheet per inferred file"
    assert wbxml.index('name="Summary"') < wbxml.index('name="clean"'), "Summary must be the FIRST sheet"
    shared = x.read("xl/sharedStrings.xml").decode("utf-8")
    for needle in ("inferred type", "format", "precision", "nullable", "confidence",
                   "candidate key", "alternatives", "date", "float", "yyyy-MM-dd", "North",
                   "top_freq_val_1", "top_freq_val_10"):
        assert needle in shared, f"combined XLSX lacks '{needle}' (metadata block, Summary, or data rows missing)"
    # Summary (first worksheet part): header autofilter over all 21 columns, freeze pane
    # below the header and before the top_freq_val_* columns, no wrapped cells, fitted widths
    sm = x.read("xl/worksheets/sheet1.xml").decode("utf-8")
    assert '<autoFilter ref="A1:U1"' in sm, "Summary autofilter missing/misplaced"
    assert 'xSplit="11"' in sm and 'ySplit="1"' in sm, "Summary freeze pane must sit after the metadata columns and below the header"
    assert 'wrapText="1"' not in sm, "Summary cells must not wrap"
    assert "<cols>" in sm, "Summary columns must carry fitted widths"
    # per-file sheets: data-header autofilter + the type/nullable review dropdowns
    pf = x.read("xl/worksheets/sheet2.xml").decode("utf-8")
    assert "<autoFilter " in pf, "per-file data header autofilter missing"
    assert 'type="list"' in pf and "string,int,float,bool" in pf and "true,false" in pf, \
        "type/nullable dropdown validations missing"
    print(f"[{browser_name}] combined XLSX: Summary-first (autofilter, freeze L2, top-freq columns) "
          f"+ 2 file sheets with dropdowns verified")

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

    # ---- B035: Summary-sheet micro-claims (full-column frequency, first-seen tie order,
    # 80-char truncation, bold/filled header). A dedicated single-file pick makes the exact
    # top-frequency ordering deterministic without disturbing the earlier sections.
    LONG = "x" * 85
    (tmp / "freq.csv").write_text(
        "grade,note\nA," + LONG + "\nA," + LONG + "\nY," + LONG + "\nX," + LONG + "\n",
        encoding="utf-8")
    page.set_input_files("#inFiles", [str(tmp / "freq.csv")])
    page.wait_for_timeout(200)
    page.click("#run")
    page.wait_for_function("() => document.getElementById('progress').textContent.startsWith('done')",
                           timeout=60000)
    with page.expect_download() as dl:
        page.click("#xlsx")
    fpath = tmp / "freq.xlsx"
    dl.value.save_as(str(fpath))
    fx = zipfile.ZipFile(fpath)
    shared = shared_strings(fx.read("xl/sharedStrings.xml").decode("utf-8"))
    sheet1 = fx.read("xl/worksheets/sheet1.xml").decode("utf-8")  # Summary is first
    # Summary rows: row1 header, row2 = grade column, row3 = note column. SUM_META has 11 cols.
    grade_top = row_topfreq(sheet1, 2, shared, 11)
    # A occurs twice (frequency winner); Y and X tie at 1 and keep FIRST-SEEN order (Y before X,
    # which is NOT alphabetical) — pins full-column frequency + stable tie order at once.
    assert grade_top[:3] == ["A", "Y", "X"], f"frequency winner / first-seen tie order wrong: {grade_top}"
    note_top = row_topfreq(sheet1, 3, shared, 11)
    trunc = "x" * 79 + "…"
    assert note_top and note_top[0] == trunc, f"80-char truncation wrong: {note_top[:1]!r}"
    # bold + tinted Summary header land in styles.xml
    styles = fx.read("xl/styles.xml").decode("utf-8")
    assert "<b/>" in styles, "Summary header bold font missing from styles.xml"
    assert "FFEAEEF2" in styles, "Summary header fill colour missing from styles.xml"
    print(f"[{browser_name}] Summary micro-claims: winner+first-seen ties {grade_top[:3]}, "
          f"80-char truncation, bold/filled header verified")

    browser.close()

fatal = [e for e in errors if "favicon" not in e]
if fatal:
    print("PAGE ERRORS:")
    for e in fatal:
        print(" -", e)
    sys.exit(1)
print(f"batch-infer drive OK ({browser_name})")
