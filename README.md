<img src="public/logo.svg" width="64" alt="Gloss logo" />

# Gloss

**A study workspace where your notes and your diagrams point at each other.**

Gloss is a Notion-style app for studying: courses hold materials, pages have numbered sections and subsections, and
images get numbered **regions** whose comments link to passages in your text — hover one and all three light up. It
also has Jupyter-style notebooks, an Excalidraw canvas, slide and PDF import, formulas, links between pages, a trash,
version history, backups and exports. It runs on your own computer; your notes stay in a local folder.

> The name: a *gloss* is the note a scribe wrote beside a passage or picture to explain it (it is where "glossary"
> comes from). The logo is the app's own region marker — a box with its number badge — on the brand red.

## Features

- **Courses → materials → sections.** Pages, annotated images, notebooks and folders, organised in a sidebar tree with
  drag and drop.
- **Block editor.** `/` menu, Markdown shortcuts, numbered Sections (1, 2…) and Subsections (1.1…), a live index,
  callouts, tables, toggles, code, colours.
- **Annotated images.** Drag boxes on any image, comment each region, link passages of your notes to it. Hovering a
  region, its comment or a linked passage highlights all three.
- **Slides and PDFs.** Import a `.pdf` or `.pptx`: every slide becomes an annotated page, titled and searchable.
- **Notebooks.** Code and markdown cells with Python in the browser (nothing to install) or in your own venv/conda
  environment through a real Jupyter kernel. Import and export `.ipynb`.
- **Formulas.** Type `$x^2$` or `$$` for LaTeX formulas in any page.
- **Links.** Type `@` to link another page, slide or even one region of an image; every material shows what links to
  it.
- **Canvas.** Excalidraw drawings, usable on their own or placed on pages.
- **Search everything** with `Ctrl K` — titles, sections, text, region comments, slide text, code, drawings.
- **Nothing gets lost.** Trash with Undo (30 days), version history, a database backup every time the app starts.
- **Take it with you.** Export a course as Markdown or PDF, or everything as one zip.
- **Guided tour** on first launch, with Skip; replay it from the sidebar.

## Quick start

Requires **Node.js 22.13+**.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. A new installation starts with sample courses that show every feature, and a guided
tour.

For a single-port production build:

```bash
npm run build
npm start          # http://localhost:3001
```

## Documentation

The full guide is in [`docs/`](docs/README.md):

- [Getting started](docs/getting-started.md) · [The workspace](docs/workspace.md) · [Pages](docs/pages.md) ·
  [Annotated images](docs/annotated-images.md) · [Slides, PDFs and folders](docs/slides-and-pdfs.md) ·
  [Notebooks](docs/notebooks.md) · [Canvas](docs/canvas.md)
- [Trash and version history](docs/trash-and-history.md) · [Backups and export](docs/backups-and-export.md) ·
  [Keyboard shortcuts](docs/keyboard-shortcuts.md) · [Troubleshooting and FAQ](docs/troubleshooting.md)
- [Configuration](docs/configuration.md) · [Architecture](docs/architecture.md) · [HTTP API](docs/api.md)

## Tech

React 19 · TypeScript · Vite · BlockNote · Excalidraw · CodeMirror · KaTeX · Pyodide · pdf.js — on an Express 5
server with Node's built-in SQLite and ZeroMQ for Jupyter kernels. Designed with the Modernist design system in
[`design/`](design/): Archivo, one red accent, square corners, 2px rules.

```
server/   API, database, search, backups, exports, Python environments and kernels, slide conversion
shared/   types and document helpers used by both sides
src/      the web app (editor, annotation, notebooks, canvas, slides, print, tour, pages, components)
docs/     documentation
```

## Your data

Everything lives in `data/` (database, uploads, backups, notebook folders), which is ignored by Git. Gloss listens only
on `127.0.0.1` and accepts requests only from this computer, because notebooks can run code on it — see
[Configuration](docs/configuration.md#security-model) before opening it to other devices.
