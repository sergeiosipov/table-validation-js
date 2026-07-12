# Corpus fixtures

The real-world-file corpus lives **base64-embedded in
[`../vectors/corpus.js`](../vectors/corpus.js)** — a `file://` test page cannot
`fetch()` sibling binaries, so embedding is what keeps the suite zero-server. Each
fixture is a byte-accurate reconstruction of a real producer's output shape:

| Fixture | Reconstructs | Structures covered |
|---|---|---|
| `XLSX_EXCEL` | desktop Excel `.xlsx` save | `sharedStrings.xml`, a shared-formula group (`<f t="shared" ref>` master + `si`-only members) with cached `<v>` results, date-styled serials (`numFmtId="14"`, 1900 system), a styled-empty region that over-reports the used range |
| `XLSX_1904` | classic Mac-Excel workbook | `<workbookPr date1904="1"/>` — serials shift by 1462 days |
| `XLSX_INLINE` | Google Sheets / LibreOffice export | `t="inlineStr"` cells, **no** sharedStrings part, unicode, `xml:space="preserve"` |
| `CSV_EXCEL_UTF8` | Excel "CSV UTF-8" export | UTF-8 BOM, semicolons, CRLF, regional decimals |
| `CSV_EXCEL_ANSI` | Excel "CSV (ANSI)" export | windows-1252 bytes (not valid UTF-8), semicolons |
| `CSV_DB_DUMP` | database CSV dump | every field quoted, doubled-quote escapes, embedded newlines/commas, LF |

## Cases where a genuine producer file would still add value

Drop real files into this directory (and extend `corpus.js` to load them base64-embedded)
if you can produce them — a reconstruction cannot prove producer quirks we did not model:

- **A genuine desktop-Excel save** (any version): Excel writes `calcChain.xml`, `theme`
  parts, `x14ac` namespaces, and occasionally windows-1252-escaped `_x005F_`-style
  sequences none of which the reconstruction includes.
- **A genuine LibreOffice Calc export**: LO writes different attribute orders and an
  `manifest.xml`-era quirk set; inline strings are covered, LO's exact writer is not.
- **A genuine Google Sheets download**: current Sheets exports include `metadata` parts
  and occasionally 1e15+ precision numerics.
- **An Excel file with real merged ranges + hyperlinks + error values in one sheet**
  (unit vectors cover these individually through ExcelJS-written files; a
  producer-written combination file would exercise the reader path end-to-end).

The reconstruction generator (internal tooling, not part of the product) lives in the
session notes; regenerating is a matter of re-emitting the ZIP parts documented above.
