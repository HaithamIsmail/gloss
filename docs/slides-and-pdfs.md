# Slides, PDFs and folders

Lecture slides and PDFs can be imported into a course. Each slide or page becomes an
[annotated image page](annotated-images.md#annotated-image-pages), so you can mark regions and write comments on it,
and all of them are kept together in a **folder**. Folders are also yours to make and fill by hand.

- [Importing slides or a PDF](#importing-slides-or-a-pdf)
- [How decks are converted](#how-decks-are-converted)
- [What you get](#what-you-get)
- [Moving between slides](#moving-between-slides)
- [Folders](#folders)
- [Troubleshooting imports](#troubleshooting-imports)

---

## Importing slides or a PDF

Start an import from either place:

- the course page: **Import slides or PDF** next to *New material*;
- **New material** (or the **+** next to a course in the sidebar) → **Import slides or PDF** — *"A folder with one
  annotated page per slide (.pptx, .pdf)"*.

Pick a file. Accepted types:

| Type | Extensions |
| --- | --- |
| PDF | `.pdf` |
| PowerPoint | `.pptx`, `.ppt`, `.pptm`, `.ppsx`, `.pps` |
| OpenDocument presentation | `.odp` |

Files can be up to **300 MB**. One import runs at a time.

A progress window shows the file name and each step:

1. *Uploading the PDF…* — or, for a deck, *Converting the slides with PowerPoint… this can take a minute.* (or *with
   LibreOffice*)
2. *Opening the document…*
3. *Rendering slide 4 of 32…* with a progress bar
4. *Creating 32 annotated pages…*

**Cancel** stops the import at the next step and creates nothing. When it finishes, the new folder opens and is
expanded in the sidebar.

## How decks are converted

PDFs are rendered directly in your browser. Slide decks are first turned into a PDF on your computer:

1. **Microsoft PowerPoint** (Windows), if it is installed. It runs invisibly, opens the deck read-only and saves a
   PDF. Presentations you already have open in PowerPoint are left alone.
2. Otherwise **LibreOffice**, if it is installed (looked for in the usual install folders on Windows, macOS and Linux,
   and on your `PATH`). It runs in the background even if you have LibreOffice open.
3. With neither, the import stops with *"No converter for slides: install LibreOffice, or export the deck to PDF
   first."* — exporting to PDF from any presentation app and importing the PDF always works.

Conversion can take up to five minutes for very large decks. The converter is detected once when the server starts:
if you install LibreOffice later, restart Gloss.

## What you get

- A **folder** at the end of the course, named after the file (e.g. *Lecture 3*).
- Inside it, one **annotated image page per slide**, in order. Each page:
  - shows the slide as a sharp image (rendered about 2000 pixels wide);
  - is titled from the slide's **largest text**, numbered: *3. Cardiac cycle*. Slides without a clear title use their
    first line of text, or *Slide 3* / *Page 3*;
  - keeps the slide's **text for search**: `Ctrl K` finds words on any slide (results labelled *Slide text*, with the
    path *Course / Folder / Slide*).
- The original file is kept: the folder page links to it (and, for decks, to the converted PDF).

## Moving between slides

On a page inside a folder, the toolbar shows **‹** *3/32* **›** and the label reads *Course · Folder · 3 of 32*.

| Action | Keys |
| --- | --- |
| Previous slide | `Page Up` or `Alt ←` |
| Next slide | `Page Down` or `Alt →` |

The keys are ignored while you are typing in a field. Only the image pages of the folder count as slides; other
materials in the folder are skipped.

## Folders

A folder groups materials inside a course. Imported slides create one, and you can make your own with
**New material → Folder** (*"Group pages, images and notebooks together"*). Folders cannot be put inside other
folders.

### The folder page

- **Label:** course code · course name · *PDF*, *Slides* or *Folder*.
- **Title**, editable.
- **Counts:** *32 slides* (or *pages* for a PDF, *items* for your own folder) and the number of regions marked on
  them.
- For imported folders: a **download link** to the original file and, for decks, a **PDF** link to the converted PDF.
- **Add to folder** creates a Page, Annotated image or Notebook inside the folder, or imports a notebook.
- A **grid** of everything in the folder:
  - image pages show the picture, with a red badge for their number of regions;
  - pages and notebooks show a small card with their kind and first sections;
  - click a card to open it; **drag** a card onto another to reorder.
- An empty folder says *This folder is empty. Use **Add to folder**, or drag materials onto the folder in the
  sidebar.*
- **Linked from** lists pages that link to the folder with `@`.

### Folders in the sidebar

A folder row shows a fold arrow, the folder icon, its title and how many items it holds. On hover: **+** (*Add to
folder*) and the trash icon (*Move folder to trash*). A folder opens by itself when one of its pages is open, and an
empty open folder shows *Empty folder*.

Drag any material onto a folder (the middle of its row) to file it there, and drag a folder onto another course to
move it with everything inside — see [Moving and organising](workspace.md#moving-and-organising).

### Deleting a folder

Moving a folder to the trash takes everything inside it along. Restoring it brings all of it back. If you restore a
single page whose folder is still in the trash, the page comes back at the top level of its course.

## Troubleshooting imports

| Message | What to do |
| --- | --- |
| *No converter for slides…* | Install LibreOffice (free) and restart Gloss, or export the deck to PDF and import the PDF. |
| *PowerPoint could not convert the file* / *LibreOffice could not convert the file* | The file may be damaged or password-protected. Open it in the app, save a copy, or export to PDF. |
| *Upload failed (500)* or *File too large* | The file is bigger than 300 MB. Export a smaller PDF (lower image quality). |
| *Only PowerPoint or OpenDocument presentations can be converted.* | The file type is not supported; convert it to PDF. |
