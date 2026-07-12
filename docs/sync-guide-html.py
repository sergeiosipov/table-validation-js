"""Sync docs/user-guide.html's embedded markdown with docs/user-guide.md.

Internal dev tooling (like make-screenshots.py): run after editing user-guide.md.
test/release-check.js fails the release when the two are out of sync.

Usage: python docs/sync-guide-html.py
"""
import pathlib
import re
import sys

DOCS = pathlib.Path(__file__).resolve().parent
md = (DOCS / "user-guide.md").read_text(encoding="utf-8")
html_path = DOCS / "user-guide.html"
html = html_path.read_text(encoding="utf-8")

# the only sequence that could terminate the script block early
if re.search(r"</script", md, re.IGNORECASE):
    sys.exit("user-guide.md contains '</script' — cannot embed it verbatim")

marker = '<script type="text/markdown" id="guide-src">\n'
start = html.index(marker) + len(marker)
end = html.index("</script>", start)
new_html = html[:start] + md + html[end:]

if new_html != html:
    html_path.write_text(new_html, encoding="utf-8", newline="\n")
    print("user-guide.html updated (embedded markdown refreshed)")
else:
    print("user-guide.html already in sync")
