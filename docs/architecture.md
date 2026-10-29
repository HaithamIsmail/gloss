# Architecture

For developers: how Gloss is built and where things are.

- [Stack](#stack)
- [Project layout](#project-layout)
- [How the pieces talk](#how-the-pieces-talk)
- [Data model](#data-model)
- [Content formats](#content-formats)
- [Key mechanisms](#key-mechanisms)
- [Working on the code](#working-on-the-code)

---

## Stack

| Part | Technology |
| --- | --- |
| Web app | React 19, TypeScript, Vite 8, react-router 7, TanStack Query 5, zustand 5 |
| Page editor | [BlockNote](https://www.blocknotejs.org) 0.55 (ProseMirror/Tiptap) with Mantine UI |
| Drawings | [Excalidraw](https://excalidraw.com) 0.18 |
| Notebook editor | CodeMirror 6; markdown via marked + KaTeX, sanitised with DOMPurify |
| Formulas | KaTeX |
| Browser Python | Pyodide (in a Web Worker) |
| PDF rendering | pdf.js (in the browser) |
| Server | Node.js 22.13+, Express 5, `node:sqlite` (SQLite in WAL mode), multer, ws, yazl |
| Local Python kernels | Jupyter messaging protocol over ZeroMQ (`zeromq` package) to `ipykernel` |
| Slide conversion | PowerPoint (COM, via PowerShell) or LibreOffice (headless) |

The design follows the Modernist design system from `design/`: Archivo, one red accent (`#ec3013`), square corners
and 2-pixel rules.

## Project layout

```
server/
  index.ts          Express app: routes, static files, kernel WebSocket, startup tasks
  db.ts             SQLite connection, schema and migrations, settings, transactions
  repo.ts           Courses, materials, drawings, trash, versions, links, moves
  search.ts         Search over everything
  backup.ts         Backups (VACUUM INTO) on start and on demand
  export.ts         Markdown and "everything" zip exports
  seed.ts           Sample courses for a new installation
  envs.ts           Python environment discovery, custom interpreters, ipykernel install
  kernels.ts        Local Jupyter kernels (ZeroMQ) bridged to WebSockets
  kernel_wrapper.py Starts a kernel and forwards interrupts (works on Windows)
  convert.ts        Slide deck → PDF with PowerPoint or LibreOffice
  pptx_to_pdf.ps1   PowerPoint automation script
  security.ts       Local-only Host/Origin checks
  themes.ts         Theme files: listing, choosing, creating, duplicating, removing
shared/
  api.ts            Types shared by client and server
  content.ts        Reading BlockNote documents: outline, regions, mentions, text
  pages.ts          Material kinds and their content (image pages, folders, notebooks, books)
  kernel.ts         Kernel protocol types
src/
  App.tsx           Routes and the app shell
  api.ts            HTTP client and React Query hooks
  store.ts          UI state (zustand), persisted preferences
  editor/           BlockNote schema and custom blocks: annotated image, drawing, callout,
                    formulas, @ mentions, slash menu, toolbar buttons
  annotate/         Region drawing and comment list (block and image page)
  notebook/         Code editor, outputs, kernels (Pyodide worker, WebSocket), .ipynb
  drawing/          Excalidraw wrapper and the full-screen drawing dialog
  slides/           PDF/slide import (pdf.js rendering, progress dialog)
  books/            The library: adding a book (metadata, cover), the PDF viewer (pdf.js) and
                    the EPUB viewer (foliate-js), highlight locations
  print/            Read-only rendering for print/PDF and version previews
  tour/             First-run guided tour
  theme/            Applying the chosen theme (adopted stylesheet, first-paint cache)
  components/       Sidebar, top bar, search, index, dialogs, toasts…
  pages/            Home, course, canvas, trash, backups, print, material views
  styles/           Design tokens and styles
themes/             Built-in themes (CSS, with their fonts) and the theme template
vendor/foliate-js/  The EPUB renderer, vendored at a pinned commit (see its README)
docs/               This documentation
design/             The original design prototype and design system
public/             Logo and icons
```

## How the pieces talk

```
Browser ──HTTP──▶ /api/*            Express routes ─▶ repo.ts ─▶ SQLite (data/study.db)
        ──HTTP──▶ /uploads/*        files in data/uploads
        ──WS────▶ /api/kernels/ws   kernels.ts ─ZeroMQ─▶ ipykernel (your Python env)
Pyodide (Web Worker in the browser) runs browser-Python notebooks with no server involvement.
```

- The client keeps the course tree (`GET /api/tree`) and each open material in React Query's cache and updates them
  optimistically.
- Pages, image pages and notebooks save their whole content with `PATCH /api/materials/:id` after a short pause. The
  server derives the outline, region count and `@` links from the content on every save.
- A full HTTP reference is in [api.md](api.md).

## Data model

SQLite tables (`server/db.ts`):

| Table | Holds |
| --- | --- |
| `courses` | id, name, code, position, timestamps, `deleted_at`, `trash_id` |
| `materials` | id, course (`NULL` for a book in the library only), `parent_id` (folder), `kind` (doc/image/notebook/folder/book), title, `content` (JSON), derived `outline` and `regions` (highlights, for a book), position, timestamps, `deleted_at`, `trash_id` |
| `drawings` | id, title, course, Excalidraw `scene` (JSON), SVG `preview`, searchable `text`, timestamps, `deleted_at`, `trash_id` |
| `trash` | one row per delete: kind, item id, title, location, count of contained items, time |
| `material_versions` | earlier contents of a material |
| `links` | `@` links: source material → target material (and region) |
| `settings` | key/value JSON (added Python interpreters, backup fingerprint, chosen theme) |

- **Soft delete:** deleting sets `deleted_at` and a shared `trash_id` on everything removed together (a course and its
  materials, a folder and its pages). All normal queries skip deleted rows. Restore clears them; purge deletes rows.
- **Ordering:** `position` is a real number; moving between two items takes the midpoint.
- **Migrations** run at start: missing columns are added (`ALTER TABLE … ADD COLUMN`), new tables created. One
  rebuilds `materials` to make `course_id` nullable (SQLite can't drop a NOT NULL); it first copies the database to
  `data/backups/gloss-before-library-….db`.
- IDs are nanoids.

## Content formats

| Kind | `content` |
| --- | --- |
| Page (`doc`) | BlockNote document JSON. Custom blocks: `annotatedImage` (props `url`, `name`, `annotations` — JSON string of `{id,x,y,w,h,comment}` in percent — and `layout`), `drawing` (`drawingId`), `callout` (`tone`), `mathBlock` (`latex`). Custom inline content: `math` (`latex`), `mention` (`targetId`, `annotationId`, `blockId`, `label`). Linked passages are the `annotation` text style whose value is a region id. |
| Image page | `{ url, name, annotations: [...], text? }` (`text` = words on an imported slide) |
| Notebook | nbformat 4 (`cells`, `metadata`), each cell's `source` stored as one string; `metadata.study_kernel` is the chosen kernel |
| Folder | `{ source?: { name, url, pdfUrl, type: "pdf" \| "slides" } }` |
| Book | `{ file: { url, name, format: "pdf" \| "epub", size }, meta: { authors, year?, publisher?, description?, tags }, coverUrl, length, status: "unread" \| "reading" \| "done", progress: { loc, fraction, label?, updatedAt }, highlights: [{ id, loc, quote, note, at, createdAt }] }`. A `loc` is `{ kind: "pdf", page, rects: [{ p, x, y, w, h }] }` (fractions of the page) or `{ kind: "epub", cfi }`. |

## Key mechanisms

- **Numbering.** Section/subsection numbers are computed from H1/H2 blocks (`shared/content.ts → buildOutline`) for the
  index, sidebar, search and exports, and drawn in the editor with CSS counters. Region numbers run through the page
  in document order (`src/editor/analyze.ts`).
- **Hover sync.** The hovered region id lives in the zustand store; a generated stylesheet (`AnnotationCSS`) highlights
  the matching box, comment and passages without re-rendering the editor.
- **Autosave and flushing.** Each editor debounces saves and registers a *flusher* (`src/flush.ts`); actions that read
  saved state (version history, export, print, trash) call `flushAll()` first.
- **Versions.** `updateMaterial` stores the previous content when the newest version is ≥ 10 minutes old (max 100).
- **Links.** On each save of a page, its `@` mentions are written to the `links` table (rebuilt on start if empty);
  backlinks are a query on it.
- **Backups.** `VACUUM INTO` on start (skipped if a fingerprint of row counts and timestamps is unchanged) and on
  demand; newest 20 kept.
- **Exports.** `server/export.ts` converts BlockNote JSON to Markdown and streams zips with yazl. PDF is the browser's
  print of `/print/:scope/:id`, rendered by `src/print/Static.tsx`.
- **Kernels.** Pyodide runs in a Web Worker (`src/notebook/pyodide.worker.ts`, `boot.py`). Local kernels are started by
  `kernel_wrapper.py` with a connection file, spoken to over ZeroMQ with HMAC-signed Jupyter messages, and bridged to the
  page over a WebSocket; one kernel per notebook, kept 15 minutes after the last client leaves.
- **Slides.** Decks are converted to PDF on the server; the browser renders each PDF page with pdf.js to a JPEG,
  uploads it, extracts its text and title, and the server creates the folder in one transaction.
- **Books.** The file is uploaded as it is. PDFs are shown by pdf.js's own viewer (`pdfjs-dist/web/pdf_viewer`),
  which renders pages as they scroll into view and fetches the file with HTTP range requests (`/uploads` supports
  them), so large files are never read whole. EPUBs are shown by foliate-js (`vendor/foliate-js`), paginated in an
  iframe styled from the theme's variables. A highlight's location is page rectangles (PDF) or an EPUB CFI; the
  viewers draw them (a layer per page, or foliate's overlayer) and turn a selection into one. Every change goes
  through `POST /api/materials/:id/book`, a merge of one part (status, progress, metadata, or one highlight) onto
  the stored content, so a book open in two tabs never loses the other's edits; progress updates skip version
  snapshots. Highlights are the book's "regions", so `@` mentions, backlinks, search and exports reuse the region
  paths with the highlight id as `annotationId`; a mention to a book opens in a new tab. A book may have no course
  (`course_id NULL`): the tree lists such books in `library`, paths show "Library", and `findMaterial` (client)
  finds them without a course.
- **Themes.** All colours, fonts, radii and rule weights are CSS variables in `src/styles/tokens.css`;
  `theme-hooks.css` says where the type and shape variables apply. A theme file overrides them (and may add rules).
  The chosen theme's CSS is fetched, its relative `url()`s made absolute, and put in `document.adoptedStyleSheets`,
  which cascade after every page stylesheet — so it wins even over CSS that lazy pages load later. A copy is cached
  in `localStorage` and applied by an inline script in `index.html` before the first paint. Theme previews in Settings
  are `srcdoc` iframes that load the real theme file over a small mock of the app.
- **Guided tour.** `src/tour/steps.tsx` lists steps (target selector, page to open, text); `Tour.tsx` dims the screen
  with a spotlight, places the card beside the target, and remembers completion in `localStorage` (`gloss-tour`).

## Working on the code

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # client + server
npm run build        # production bundle
```

Tips:

- Test against a throw-away workspace: `DATA_DIR=/tmp/gloss-test API_PORT=3002 npm run dev:api` and
  `API_PORT=3002 npx vite --port 5174`.
- In development, the page editor is available as `window.__editor` in the browser console, and
  `window.__addBook(blob, "name.pdf", courseId?)` adds a book without the file dialog (no course id: the library only).
- Shared types and helpers go in `shared/` so client and server agree.
