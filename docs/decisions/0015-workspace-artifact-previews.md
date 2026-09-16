# ADR 0015: Passive workspace artifact previews

## Context

Research artifacts include scripts, financial models, notebooks and documents.
The original viewer covered Markdown, plain text, raster images and native PDF
iframes. Supporting these artifacts must not turn Desk into an IDE, spreadsheet
calculation service or another agent runtime. Initial workspace browsing should
not load document parsers.

## Decision

Keep the existing shared chat/workspace reader, tabs, revision checks and download
routes. Add a small format map and lazy format components. Format detection stays
on the host file boundary, using signatures and UTF-8 inspection; extensions
choose presentation only after checking bytes. HTML and SVG are source text,
never rendered as active documents. Unknown valid UTF-8 files can be read as text.

- Source files and fenced Markdown/chat snippets use Shiki's maintained grammars through Streamdown's native
  code-highlighter interface. Grammars are lazy-loaded; no compiler, LSP or execution
  service is installed. Module extensions, Rust, Python, configuration files and
  other common source languages share the same viewer and themes. A thin adapter
  bounds token caching to 16 entries / 200,000 source characters and 16 pending
  jobs. Full-source keys prevent prefix/suffix collisions. The stock Streamdown
  code extension was rejected because its token cache is unbounded and its keys
  do not include the entire source.
- CSV/TSV use Papa Parse without automatic value coercion. Excel XLSX/XLS/XLSM/XLSB
  and OpenDocument spreadsheets use the pinned SheetJS CE release from its
  official distribution. They share a paginated table and worksheet selector.
  Saved formatted values and formulas are displayed. Missing formula values are
  marked unavailable; no recalculation, macros, external links, chart engine or
  pivot-table execution is added. Cached workbook values may be stale.
- DOCX uses Mammoth's browser build for semantic content, followed by a narrow
  DOMPurify allowlist. External-file access and embedded style maps are disabled.
  Only embedded raster document images are retained. Converted links are checked;
  external links require a user click. Word pagination and exact styling are not
  reproduced.
- Jupyter nbformat 4 notebooks show Markdown/code cells and saved plain-text/PNG
  outputs. HTML, JavaScript and widget outputs are ignored. No kernel runs.
- PDF.js renders one page at a time with local worker and character-map assets,
  bounded canvas dimensions, page navigation, zoom and an extracted-text view.
  Every completed or cancelled page operation releases native page resources;
  limiting the visible canvas alone does not bound decoded-image retention. XFA and annotation
  actions are not enabled. No remote viewer or conversion service is involved.
- Common raster images use the browser decoder. Recognized MP3/WAV/M4A and
  MP4/WebM files use native media controls and existing byte-range delivery.

## Resource and trust boundaries

Heavy CSV, Office and notebook parsing runs in a disposable browser worker. A
revision-pinned admitted API read is bounded while receiving bytes, even if a
length header is absent. Closing or replacing the preview aborts its fetch and
terminates its worker. Query results are released when the preview has no
observers; there is no durable preview database or background workspace scan.

Initial limits are deliberately conservative: 10 MiB parsed input, Office ZIP
metadata limited to 2,000 entries / 40 MiB declared expansion, 1,000 table rows,
50 columns, 100 sheet choices, 100 rows per rendered page, 2,000 characters per
cell and a 200,000-character table payload. Converted DOCX HTML is limited to
1,000,000 characters and 10,000 markup delimiters before DOM rendering. Code displays at most 100,000
characters. Notebooks show at most 100 cells with bounded source/output text and
embedded images. Parsed workers have a 15-second completion budget. ZIP metadata
preflight is a screening limit, not a guarantee of arbitrary parser memory usage.
PDF canvases are limited to 4,096 pixels per dimension. Limits, including omitted notebook outputs or additional/oversized figures, produce an explicit
partial/unavailable preview while preserving access to the original file.

## Consequences and rejected alternatives

Libraries load when the relevant preview is opened, not when the explorer lists
files. This keeps dependencies format-specific and reusable across the existing
viewer surfaces. Office data is transformed for display only; user-owned bytes
are never rewritten.

Reject full editors, universal document frameworks, cloud Office viewers,
LibreOffice conversion services, notebook execution, and custom language parsers.
Legacy DOC, PPT/PPTX, Parquet, proprietary image formats and archive extraction
remain download-only until a demonstrated use justifies a maintained adapter.
The format map is an internal implementation detail, not a public plugin system.


## Preview controls and source presentation

Format-specific controls share a compact, full-width toolbar above the preview.
The toolbar stays visible while reading; PDF navigation and zoom are grouped,
image sizing lives there, and worksheet/row navigation uses the same structure.
Source files render as selectable, highlighted text with a line-number gutter,
with the detected language and copy action in the toolbar. Source rendering is
bounded to 100,000 characters and 5,000 lines to avoid excessive DOM work. Notebooks follow [JupyterLab's cell layout](https://jupyterlab.readthedocs.io/en/stable/user/notebook.html):
a narrow saved execution-prompt gutter, lightly bordered input cells, and outputs
directly underneath, with Markdown aligned to cell contents. Counts come from
notebook metadata, never document order; missing counts stay blank. Input cells
omit editor line numbers and repeated toolbars. Pythia tokens and the shared
preview toolbar supply the chrome; execution and editing remain out of scope.
Chat Markdown keeps its fenced-code presentation. This separates file inspection from conversational
snippets without adding an editor or language-server dependency.


Image controls follow ordinary image-viewer conventions: zoom in/out, actual
size, fit within the available pane, and quarter-turn rotation. PDF controls
include page navigation, zoom, fit width, fit page, rotation and saved text view,
following Chrome's basic viewer controls. Rotation affects presentation only.
Fit responds to the reader pane's dimensions, and rotated content retains its
aspect ratio and scrollable bounds. No image transformations or PDF edits are
written back to the user's files.

Open file tabs retain only revision-bound page, worksheet, row-page, zoom and
rotation settings in the existing reader owner. Closing a tab removes these
records. Returning to a document waits for parsed content before restoring its
scroll offset; document data and workers still release when inactive.

Desk's dev and build commands copy the pinned PDF.js CMaps into a versioned,
ignored public asset directory included in the build cache outputs. Requests remain local and no font service or
remote viewer is introduced. The production PDF.js viewer's browser regressions
replace the earlier Chromium-iframe qualification harness.
