# Artifacts

An **artifact** is an HTML page kept in a course as it is: an interactive explainer, a diagram, a quiz, a
calculator, a dashboard, a small game. It is the same kind of thing Claude makes as an *artifact* (and what any other
tool or person can write by hand): one `index.html`, with any stylesheets, scripts, images or data files it uses.
Gloss shows it live inside the page, in an isolated frame, keeps its files in your data folder, lets you edit the
source in the app, and gives agents a small API to add and edit artifacts for you.

- [Adding an artifact](#adding-an-artifact)
- [The artifact page](#the-artifact-page)
- [Editing the source](#editing-the-source)
- [Agents: adding and editing artifacts by API](#agents-adding-and-editing-artifacts-by-api)
- [What an artifact may do](#what-an-artifact-may-do)
- [Where the files are](#where-the-files-are)
- [Limits](#limits)

---

## Adding an artifact

**New material** (on a course page, or the **+** next to a course or folder) → **Add artifact** — *"An HTML page
from Claude or any tool, shown live and editable"*. Pick the `.html` file; hold `Ctrl` to pick the files it uses too
(a `styles.css`, a `script.js`, images, a `data.json`). They keep their names, so relative links in the page keep
working. One of the files must be the page: `index.html`, or the only `.html` file, which is renamed to
`index.html`.

The title is read from the page's `<title>`; click it to rename. A one-line **description** can go under it.

Where an artifact comes from:

- **Claude.** Ask Claude for an artifact, then download it as an HTML file (on claude.ai, *Download* on the
  artifact; in Claude Code, the file Claude wrote). Add that file here.
- **An agent working for you.** Claude Code, or any script, can add an artifact to a course and edit it later
  through the [API](#agents-adding-and-editing-artifacts-by-api), no download needed.
- **Anything that writes HTML:** a notebook export, a slide tool, your own hand-written page.

## The artifact page

![An artifact: the page live in a frame, its source beside it](images/artifact.png)

The page fills the window below a slim bar:

| Bar | What it does |
| --- | --- |
| **Reload** | runs the page again from the start (state inside the page is lost) |
| **Open** | the page in its own browser tab |
| **Download** | the page and its files as a zip, to take it to another tool or back to Claude |
| **Add files** | add or replace files the page uses (an image, a script, data); a file with the same path is replaced |
| *n files · source* | how many files it has, and a link to where it came from when that is known |
| **Source** | the [source panel](#editing-the-source) |
| ⤢ | fill the whole window with the page; `Esc` or ⤡ comes back |

Like every material, an artifact can be moved between courses and folders, linked with `@` from a page (*Linked
from* shows under its title), found with `Ctrl K` (by title, description, or the words on the page), put in the trash
and restored, and exported with the course (the Markdown zip holds a folder with its files).

## Editing the source

**Source** opens an editor beside the page. The dropdown lists the artifact's files; text files (`.html`, `.css`,
`.js`, `.json`, `.md`, `.svg`, `.csv`…) open in the editor with highlighting, images and other binary files show
their size. **Save** (or `Ctrl S`) writes the file and reloads the page. The file you had open isn't changed by
anyone else while you have unsaved edits; once you save, or if you have nothing unsaved, edits made from outside
(an agent, another tab) show up by themselves.

Every time `index.html` is saved — from the editor, by an agent, or by **Add files** — the version it replaces is kept.
The clock icon next to the file dropdown lists these **earlier versions**, newest first; click one to put it back
(the current page is kept in the history first). The last 20 are kept per artifact. Other files have no history.

A file other than `index.html` can be removed with the bin icon in the source bar.

## Agents: adding and editing artifacts by API

The point of artifacts is that an agent — Claude Code at your side, a script, a scheduled job — can build a page
for a course and keep improving it. The whole surface is a few HTTP calls on the local server (port **3001** when
started with `start.bat` / `npm run app`; `/api` is proxied in development too). Requests must come from this
computer, like the rest of the [API](api.md).

Find the course id in the tree:

```bash
curl -s http://localhost:3001/api/tree | jq '.courses[] | {id, code, name}'
```

**Add an artifact** from HTML text (the title falls back to the page's `<title>`):

```bash
curl -s -X POST http://localhost:3001/api/courses/COURSE_ID/artifacts \
  -H 'Content-Type: application/json' \
  -d '{"title":"Fourier series, step by step","description":"Drag the sliders to add harmonics.","html":"<!doctype html><html><head><title>Fourier</title></head><body>…</body></html>","files":[{"path":"styles.css","text":"body{margin:0}"}]}'
```

The response is the material: note its `id`. Optional fields: `parentId` (a folder in the course), `source` (where it
came from, e.g. a `claude.ai/artifact/…` link, shown as a link on the page), `files` (other text files by path).

**Add an artifact** from files on disk (multipart, any number of files; `paths` keeps sub-folders):

```bash
curl -s -X POST http://localhost:3001/api/courses/COURSE_ID/artifacts \
  -F files=@index.html -F files=@app.js -F files=@img/figure.png \
  -F 'paths=["index.html","app.js","img/figure.png"]'
```

**Read a file**, as text in JSON or as it is:

```bash
curl -s "http://localhost:3001/api/materials/ARTIFACT_ID/artifact/text?path=index.html" | jq -r .text
curl -s "http://localhost:3001/api/materials/ARTIFACT_ID/artifact/file?path=img/figure.png" -o figure.png
```

**Edit** a text file (the whole file is replaced; `index.html` keeps its earlier version in the history):

```bash
curl -s -X POST http://localhost:3001/api/materials/ARTIFACT_ID/artifact/text \
  -H 'Content-Type: application/json' \
  -d @- <<'EOF'
{"path":"index.html","text":"<!doctype html>…"}
EOF
```

**Add or replace any file** with its bytes (`PUT`), **remove** one (`DELETE`), **list** them, and change the
description:

```bash
curl -s -X PUT "http://localhost:3001/api/materials/ARTIFACT_ID/artifact/file?path=data/points.csv" --data-binary @points.csv
curl -s -X DELETE "http://localhost:3001/api/materials/ARTIFACT_ID/artifact/file?path=old.js"
curl -s http://localhost:3001/api/materials/ARTIFACT_ID/artifact/files
curl -s -X POST http://localhost:3001/api/materials/ARTIFACT_ID/artifact -H 'Content-Type: application/json' -d '{"description":"Now with damping."}'
```

An artifact open in the app notices these changes within a few seconds and reloads. The page is at
`http://localhost:3001/artifacts/ARTIFACT_ID/index.html` for an agent that wants to look at the result (with a
browser tool, say).

Tips for an agent writing pages for Gloss:

- Make `index.html` self-contained where you can: inline CSS and JS, or put them in files beside it with relative
  paths (`styles.css`, not `/styles.css`).
- Libraries from a CDN are fine (the frame may load scripts from anywhere), but the page is shown offline-first:
  prefer no dependency to one.
- `localStorage` and friends are not available inside the frame (see below) — wrap any use in `try/catch` and make
  the page work without it. There is no `window.claude` runtime: the page is static.
- Put a `<title>`: it becomes the material's title.

The full endpoint list is in [HTTP API → Artifacts](api.md#artifacts).

## What an artifact may do

An artifact is someone else's code running in your notes, so it is kept apart from the app:

- It runs in a **sandboxed frame** with an **opaque origin**: the server sends every artifact page with a
  `Content-Security-Policy: sandbox …` header, so it is isolated in the frame and just the same when opened in its
  own tab.
- It **can**: run scripts, draw, animate, use forms, open links in new tabs, download files, show dialogs, load
  images, fonts, scripts and data from its own files or from the web.
- It **cannot**: read or change your notes, call Gloss's API (the server refuses requests with a null origin on
  `/api`), see the app's page, or keep `localStorage` / `IndexedDB` / cookies (an opaque origin has none; a page
  from Claude already guards those with `try/catch`).

If you need a page that talks to Gloss, use a [notebook](notebooks.md) instead, which runs with your permission.

## Where the files are

`data/artifacts/<material id>/` — the files exactly as added, plus `.history/` with earlier `index.html` versions.
They are included in **Export everything** and in backups' companion data, and copied into a folder next to the
artifact's `.md` note in a Markdown export. Deleting an artifact for good (from the trash, or after 30 days) removes
the folder.

You can edit the files in that folder with any editor; the app picks the change up on its next look (every few
seconds while the artifact is open).

## Limits

| | |
| --- | --- |
| One file | 16 MB |
| Files per artifact | 512 |
| Earlier versions of `index.html` kept | 20 |
| Paths | relative, forward slashes, no `..`, no hidden (`.`-prefixed) names |
