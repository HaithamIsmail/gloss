# Troubleshooting and FAQ

- [Common problems](#common-problems)
- [FAQ](#faq)
- [Known limits](#known-limits)

---

## Common problems

**`npm run dev` fails with an error about `node:sqlite`.**
Your Node.js is too old. Install Node 22.13 or newer (`node --version`).

**The page says *Not saved — retrying on next edit*.**
The API server isn't reachable (stopped, or crashed). Check the terminal running `npm run dev`. Your text stays on the
page; the next edit after the server is back saves it.

**Requests fail with *Requests are only accepted from this computer.***
You opened Gloss through an address other than `localhost`/`127.0.0.1`. Use `http://localhost:5173` (dev) or
`http://localhost:3001` (production), or add the address to `ALLOWED_HOSTS` — see
[Configuration](configuration.md#opening-gloss-to-other-devices).

**Port 3001 or 5173 is already in use.**
Another copy of Gloss (or another app) is running. Stop it, or use another port: `API_PORT=3005 npm run dev`
(the web app stays on 5173 and follows `API_PORT`), or `PORT=8080 npm start`.

**Importing a `.pptx` says *No converter for slides*.**
Install [LibreOffice](https://www.libreoffice.org) (free) or Microsoft PowerPoint, then restart Gloss — or export the
deck to PDF and import the PDF. See [Slides and PDFs](slides-and-pdfs.md#troubleshooting-imports).

**A browser notebook says it can't load a package.**
Packages for browser Python are downloaded the first time they are used, so this needs internet. Packages with compiled
code that Pyodide doesn't provide (e.g. torch, tensorflow, seaborn) can't run in the browser: use a local
environment.

**My conda/venv environment doesn't appear in the kernel picker.**
Click ↻ (*Search again*). If it lives somewhere Gloss doesn't scan (e.g. a project's `.venv`), use **Add an
interpreter…** with its folder. See [where Gloss looks](notebooks.md#your-own-python-environments).

**An environment is greyed out.**
It doesn't have `ipykernel`. Click **Install ipykernel**, or run `python -m pip install ipykernel` in it.

**A local notebook stays *Disconnected*.**
The environment it remembers was removed or moved. Pick another kernel in the picker.

**`Stop` is greyed out.**
The browser kernel can't be interrupted. Use **Restart** (variables are lost), or use a local environment.

**I deleted something by mistake.**
Use **Undo** in the message at the bottom of the screen, or restore it from the **Trash** within 30 days.

**I overwrote a page.**
**⋯ → Version history** has its earlier states (kept every 10 minutes while editing).

**My database is damaged / I want yesterday's data.**
Restore a backup from `data/backups/` — see [Restoring a backup](backups-and-export.md#restoring-a-backup).

**`Ctrl K` doesn't open search.**
Inside a drawing, and in a page while text is selected, `Ctrl K` belongs to the editor (it makes a link). Click
elsewhere first, or use **Search** in the sidebar.

**My theme edits don't show up.**
Save the file, then click into the Gloss window: themes are reloaded when the window gets focus. Check that the file is
in your themes folder (Settings → Themes shows its path) and ends in `.css`. A typo in CSS only breaks the rule it is
in; the browser's developer tools (F12) show which.

**A theme's fonts don't load.**
Font files must be next to the theme, in a folder with the theme's name, and linked relatively
(`url("my-theme/fonts/x.woff2")`). Web fonts (`@import url("https://…")`) need internet.

**The guided tour keeps appearing / never appears.**
It shows once per browser. It reappears if your browser doesn't keep site data (private windows). Replay it any time
with **Guided tour** in the sidebar.

## FAQ

**Does Gloss need internet?**
No. Everything runs on your computer. Only browser-Python packages are downloaded on first use.

**Can I use it from my phone or tablet?**
Yes, on your local network, by opening it to other devices (see
[Configuration](configuration.md#opening-gloss-to-other-devices)) — only on a network you trust. The layout adapts to
small screens.

**How do slides get converted without PowerPoint or LibreOffice?**
They don't: a `.pptx` file is a zipped set of XML parts, and drawing it faithfully needs a real presentation engine.
PDFs, however, are rendered directly in the browser, so exporting the deck to PDF anywhere (Google Slides, Keynote,
PowerPoint online) and importing the PDF always works.

**Where are my files? Can I open them without Gloss?**
In `data/`. Export a course as Markdown for plain files any editor can open, or as a PDF.

**Can several people use one Gloss?**
It is built for one person on one computer: there are no accounts.

**Can I sync between computers?**
Copy the `data/` folder (or use **Export everything**) while Gloss is stopped on both machines. Don't put a running
`data/` folder in a sync service: SQLite files can be corrupted by syncing while in use.

## Known limits

- **Single user**, no accounts; meant to run locally.
- **Uploaded files are never deleted**, even after their material is deleted for good: they stay in `data/uploads/`.
- **Version history** covers the content of pages, images and notebooks — not titles, and not drawings.
- **Images pasted into a drawing** are stored inside the drawing, which can make it large.
- **Notebook outputs** that need JavaScript (Plotly, Bokeh, ipywidgets) are shown without their scripts, so they
  don't run; static pictures, tables and text work. Styled HTML loses its styles.
- **Notebooks** can't copy/paste, drag, merge or split cells, and the browser kernel can't be interrupted or read
  local files.
- **Courses** can't be reordered by dragging (they're listed in creation order).
- **Links to regions** are made with `@`; *Link text* and *Link to region* only link passages to regions on the same
  page.
- **Pasting an image copied from a web page** may paste the page's HTML instead of the image; save the image and drop
  it, or copy just the image.
