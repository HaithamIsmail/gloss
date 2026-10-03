# Backups and export

Everything Gloss knows lives in the `data/` folder next to the app. Gloss backs up its database by itself, and lets
you take your notes out as Markdown, PDF or one complete zip.

Open **Backups and export** at the bottom of the sidebar (`/backups`).

- [Automatic backups](#automatic-backups)
- [Back up now and downloading backups](#back-up-now-and-downloading-backups)
- [Restoring a backup](#restoring-a-backup)
- [Export everything](#export-everything)
- [Markdown export](#markdown-export)
- [Print and PDF](#print-and-pdf)

---

## Automatic backups

Each time Gloss **starts**, it copies its database to `data/backups/gloss-2026-10-03_14-05-12.db`.

- The copy is skipped when nothing changed since the last backup (so restarting several times doesn't push useful
  backups out), and when the workspace is empty.
- The newest **20** backups are kept; older ones are deleted.
- The copy is made safely while the app is running (SQLite `VACUUM INTO`), so it is always a consistent snapshot.

Backups contain the database: courses, materials, pages, regions and comments, notebooks with their outputs,
drawings, trash and version history. Uploaded images and files are in `data/uploads/`, which Gloss only ever adds to,
so the database backups plus that folder are a complete copy.

## Back up now and downloading backups

- **Back up now** makes a backup immediately (*Backed up (76 KB)*), whether or not anything changed.
- The list shows every backup with its date (*Today 14:05*), file name and size; the newest is marked **Latest**.
- **Download** saves that backup file, e.g. to keep it on another drive.

## Restoring a backup

1. Stop Gloss (`Ctrl C` in its terminal).
2. In `data/`, rename or move away `study.db` (and the `study.db-wal` / `study.db-shm` files if they exist).
3. Copy the backup you want into `data/` and rename it to `study.db`.
4. Start Gloss again.

## Export everything

**Everything → Download .zip** downloads `Gloss data 2026-10-03.zip` containing a `data/` folder with:

- `study.db` — a fresh snapshot of the database,
- `uploads/` — every image, PDF and file you added,
- `notebooks/` — the working folders of your local notebook kernels,
- anything else in `data/` except the backups folder.

To move Gloss to another computer: install it there, unzip, and put the `data/` folder next to the app (replacing the
empty one).

## Markdown export

Export a whole course or a single material as a zip of plain Markdown files that open in any editor (VS Code,
Obsidian, Typora, GitHub…):

- **Course:** the course page's **Export as Markdown** button, or **Backups and export → A course → Markdown**.
- **One material:** **⋯ → Export as Markdown** in the top bar (pending edits are saved first).

What's inside a course zip:

```
README.md                         course title and a linked list of its materials
01 Unit 3 · The Heart.md
02 Unit 4 · Blood vessels.md
03 Lecture 5/                     a folder becomes a folder
   README.md                      folder title, link to the original file, list of pages
   01 1. Introduction.md
   02 2. Cardiac cycle.md
04 Eigenvalues in Python.md       notebooks: Markdown version…
04 Eigenvalues in Python.ipynb    …and the original notebook
assets/                           images, PDFs, drawings and notebook output pictures
```

How things are written:

| In Gloss | In Markdown |
| --- | --- |
| Page title | `# Title` |
| Section / Subsection / Heading | `## 1 Overview`, `### 1.2 Atria`, `#### Heading` (with their numbers) |
| Bold, italic, strike, code, underline, links | `**b**`, `_i_`, `~~s~~`, `` `c` ``, `<u>u</u>`, `[text](url)` |
| Lists, check lists, quotes, dividers, code blocks, tables | standard (GitHub-flavoured) Markdown |
| Callouts (note, tip, warning, exam) | `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!IMPORTANT]` |
| Formulas | `$…$` inline, `$$…$$` blocks |
| Annotated image | the image, then its region comments as a numbered list |
| Passage linked to region 3 | the passage followed by <sup>[3]</sup> |
| Image page | the image and its numbered comments |
| Drawing | an SVG picture of the drawing |
| `@` link | a relative link to the exported file, or **@Title** if the target isn't in the export |
| Notebook | markdown cells as-is, code in ```` ```python ```` fences, text output in fences, plots as pictures |

## Print and PDF

**Print or save as PDF** opens a clean, printable version of a course or material in a new tab:

- **Course:** the course page's **Print or save as PDF** button, or **Backups and export → A course → PDF**.
- **One material:** **⋯ → Print or save as PDF** in the top bar.

The print view shows the title (and, for a course, a table of contents), then every material with:

- numbered sections, formulas, tables, callouts and check lists,
- annotated images with their **numbered region boxes**, and the comments listed under each image,
- linked passages tinted and followed by their region number,
- drawings as pictures,
- notebooks with their code, outputs and rendered markdown,
- each material (and each slide of a folder) starting on a new page.

The print dialog opens by itself once all images have loaded; choose **Save as PDF** as the printer. The bar at the
top (not printed) has **Back** and **Print or save as PDF** to print again.
