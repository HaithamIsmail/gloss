# The workspace

How Gloss is organised — courses, materials and folders — and how to get around: the sidebar, the top bar, search,
and moving things.

- [Courses and materials](#courses-and-materials)
- [The sidebar](#the-sidebar)
- [The top bar](#the-top-bar)
- [Home: all courses](#home-all-courses)
- [A course page](#a-course-page)
- [Creating materials](#creating-materials)
- [Moving and organising](#moving-and-organising)
- [Search](#search)
- [On a phone or small window](#on-a-phone-or-small-window)

---

## Courses and materials

- A **course** has a name and a code (e.g. *Human Anatomy*, *ANAT 201*).
- A course holds **materials**, of four kinds:

| Kind | What it is | Guide |
| --- | --- | --- |
| **Page** | A block-editor document with numbered sections, images, formulas, drawings | [Pages](pages.md) |
| **Annotated image** | One image with numbered regions and comments | [Annotated images](annotated-images.md#annotated-image-pages) |
| **Notebook** | Jupyter-style Python code and markdown cells | [Notebooks](notebooks.md) |
| **Folder** | Groups pages, images and notebooks (imported slides arrive as a folder) | [Slides and folders](slides-and-pdfs.md#folders) |

- **Drawings** live in the [Canvas](canvas.md) and can be attached to a course and placed on pages.

## The sidebar

From top to bottom:

- **Gloss** logo — back to all courses.
- **Search** (`Ctrl K` / `⌘K`) — see [Search](#search).
- **All courses** — the home page.
- **Canvas** — your drawings.
- **Courses** — the tree:
  - a **course** row opens the course; the arrow folds it; **+** adds a material;
  - its **folders** (with an item count) and **materials**, each with its kind's icon;
  - under the open page, its **sections and subsections** (numbered) — click to jump there;
  - **Add material** at the end of an open course;
  - hover a material for its trash icon (*Move to trash*), or a folder for **+** (*Add to folder*) and trash.
  - A course or folder opens by itself when you open something inside it, and remembers being folded.
- **New course**.
- At the bottom: **Trash**, **Backups and export** and **Guided tour**.

Drag materials in the tree to organise them — see [Moving and organising](#moving-and-organising).

## The top bar

- **Sidebar button** (left) hides or shows the sidebar.
- **Breadcrumbs**: *Courses / Course / Folder / Material*. Click a part to go there; clicking the material's own name
  scrolls back to the top.
- On a material or drawing, the **save status**: *Saving…*, *Saved*, or *Not saved — retrying on next edit*.
- On a material: **View options** (sliders icon: section numbers, index, linked-passage style — see
  [View options](pages.md#view-options)) and **⋯ More actions**: Version history, Move to…, Export as Markdown, Print or
  save as PDF, Move to trash.

The browser tab shows the name of where you are (*Unit 3 · The Heart · Gloss*).

## Home: all courses

**All courses** shows how many courses and materials you have, and a card per course with its code, name, and counts
of materials, sections and regions. Click a card to open the course; **+ New course** adds one.

## A course page

- **Course code** and **name** at the top — click to edit; they save as you type. A new course has its name selected so
  you can type over it.
- **Materials** with two buttons: **Import slides or PDF** and **+ New material**.
- The **list of materials** (top level; folders show their item count). Each row shows its number, title, kind and
  counts (*3 sections · 4 regions*, *32 items*…). On hover:
  - the **grip** on the left — drag to reorder, or drop onto a folder to file the material in it;
  - **Move to…** — another course or a folder;
  - **Move to trash** — with Undo.
- At the bottom: **Export as Markdown**, **Print or save as PDF** (the whole course — see
  [Backups and export](backups-and-export.md)) and **Move course to trash** (takes all its materials with it; Undo
  available).

## Creating materials

**+ New material** on a course page, the **+** next to a course in the sidebar, or **Add material** under an open
course opens a menu:

| Option | Creates |
| --- | --- |
| **Page** | *Sections, text, images and drawings* |
| **Annotated image** | *One image, with numbered regions and comments* |
| **Notebook** | *Python code and markdown cells, like Jupyter* |
| **Folder** | *Group pages, images and notebooks together* |
| **Import slides or PDF** | *A folder with one annotated page per slide (.pptx, .pdf)* — [details](slides-and-pdfs.md) |
| **Import notebook** | *Open a .ipynb file as a new notebook* |

The new material opens straight away with its title selected (*Untitled material*, *Untitled image*, …) so you can
name it.

Inside a folder, **Add to folder** (on the folder page) or the folder's **+** (sidebar) offers Page, Annotated image,
Notebook and Import notebook — folders can't contain folders, and slide imports always make their own folder.

## Moving and organising

**Drag and drop in the sidebar**

Grab any material or folder row and drop it:

| Drop on | Result |
| --- | --- |
| the **top or bottom edge** of a row | placed before or after it (a red line shows where) |
| the **middle of a folder** row | filed inside that folder (the folder is outlined) |
| a **course** row | moved to that course, at the end |

Hold a dragged item over a folded course or folder for a moment to unfold it. Moving a folder moves everything inside
it. Folders only go between top-level items (they can't nest).

**On the course page**, drag a material by its grip to reorder it or onto a folder. **In a folder page**, drag cards to
reorder them.

**Move to…** (on a course-page row, or **⋯ → Move to…** on a material) opens a list of courses and their folders. Type
to filter. The current place is marked *Current place*. A message confirms *Moved "…" to …*.

## Search

Press `Ctrl K` (`⌘K` on a Mac) anywhere, or click **Search** in the sidebar.

- With an empty box: all courses and materials, and your recent drawings — a quick way to jump anywhere.
- Type to search (not case sensitive). Results show what they are and where they are:

| Label | Found in |
| --- | --- |
| *Course* | course names and codes |
| *Material*, *Folder*, *Slides* | material titles |
| *Section 2*, *Subsection 2.1* | page and notebook headings |
| *Text* | any other text in pages (including formulas and links) and notebook markdown |
| *Region 3* | comments on image regions |
| *Slide text* | the text on imported slides |
| *Code* | notebook code cells |
| *Drawing* | drawing titles and the words written in drawings |

- `↑` `↓` to choose, `Enter` to open, `Esc` to close.
- Opening a result takes you to the exact place: the section or block is scrolled into view and flashes, a region is
  lit up for a moment, a notebook cell is selected.
- Things in the Trash are not searched.

Inside a drawing, `Ctrl K` belongs to Excalidraw; inside a page with text selected, `Ctrl K` makes a link. Use the
sidebar's **Search** button there.

## On a phone or small window

- Below about 760 pixels wide, the sidebar slides over the page; it closes when you open something. Use the top-left
  button to open it.
- The index column is hidden below about 1180 pixels (the sidebar still lists the sections).
- Image pages stack the comments under the image; annotated image blocks put comments below the image.
