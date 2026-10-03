import type { ReactNode } from "react";
import type { MaterialSummary, Tree } from "../../shared/api";
import { LogoMark } from "../components/Logo";
import type { Placement } from "./Tour";

export type TourStep = {
  id: string;
  title: string;
  body: ReactNode;
  icon?: ReactNode;
  /** CSS selector of what to point at. Without one the popover sits in the middle. */
  target?: string;
  /** Page to open first. Returning null drops the step (e.g. no notebook exists). */
  route?: (tree: Tree) => string | null;
  /** The target is in the sidebar (opened for the step). */
  sidebar?: boolean;
  placement?: Placement;
  scroll?: ScrollLogicalPosition;
  padding?: number;
};

const all = (tree: Tree) => tree.courses.flatMap((c) => c.materials);
const course = (tree: Tree) => tree.courses.find((c) => c.materials.length) ?? tree.courses[0];
const coursePage = (tree: Tree) => (course(tree) ? `/c/${course(tree)!.id}` : null);
const open = (m: MaterialSummary | undefined) => (m ? `/m/${m.id}` : null);
/** The page that shows the most: one with regions if there is one. */
const docPage = (tree: Tree) =>
  all(tree)
    .filter((m) => m.kind === "doc")
    .sort((a, b) => b.regions - a.regions || b.outline.length - a.outline.length)[0];

const k = (s: string) => <kbd>{s}</kbd>;

export const STEPS: TourStep[] = [
  {
    id: "welcome",
    icon: <LogoMark size={40} />,
    title: "Welcome to Gloss",
    body: (
      <>
        <p>
          A workspace for studying: <strong>courses</strong> hold <strong>materials</strong>, pages have numbered
          sections, and images get numbered <strong>regions</strong> whose comments link to your text.
        </p>
        <p>This short tour shows where everything is. You can leave it at any point.</p>
      </>
    ),
  },
  {
    id: "tree",
    sidebar: true,
    target: ".sidebar-tree",
    placement: "right",
    title: "Your courses",
    body: (
      <>
        <p>
          Courses, their folders and materials, and the sections of the page you have open. Click a section to
          jump to it.
        </p>
        <p>
          <strong>+</strong> adds a material. <strong>Drag</strong> materials to reorder them, onto a folder to file
          them, or onto another course to move them there.
        </p>
      </>
    ),
  },
  {
    id: "search",
    sidebar: true,
    target: "[data-tour=search]",
    placement: "right",
    title: "Search everything",
    body: (
      <p>
        {k("Ctrl K")} (or {k("⌘K")}) searches courses, materials, sections, text, notebook cells, region comments,
        slide text and drawings. Picking a comment scrolls to its region and lights it up.
      </p>
    ),
  },
  {
    id: "add",
    route: coursePage,
    target: ".section-head-actions",
    placement: "bottom",
    title: "Add materials",
    body: (
      <>
        <p>
          <strong>New material</strong> makes a <strong>Page</strong> (block editor), an{" "}
          <strong>Annotated image</strong>, a Jupyter-style <strong>Notebook</strong> or a <strong>Folder</strong>.
          It also imports a <code>.ipynb</code> notebook.
        </p>
        <p>
          <strong>Import slides or PDF</strong> turns a deck or PDF into a folder with one annotated page per slide.
        </p>
      </>
    ),
  },
  {
    id: "list",
    route: (t) => (course(t)?.materials.length ? coursePage(t) : null),
    target: ".material-list",
    placement: "top",
    title: "Organise the course",
    body: (
      <p>
        Drag the grip on the left to reorder, or drop a material onto a folder. Hover a row for{" "}
        <strong>Move to…</strong> and <strong>Move to trash</strong>.
      </p>
    ),
  },
  {
    id: "course-export",
    route: coursePage,
    target: ".course-foot",
    placement: "top",
    title: "Take a course with you",
    body: (
      <p>
        Export the whole course as <strong>Markdown</strong> (with its images), or open a clean printable view to{" "}
        <strong>save it as a PDF</strong>.
      </p>
    ),
  },
  {
    id: "editor",
    route: (t) => open(docPage(t)),
    target: ".material-doc",
    scroll: "start",
    title: "Write with blocks",
    body: (
      <>
        <p>
          Type {k("/")} for any block: sections, lists, tables, callouts, images, drawings, formulas. Markdown
          shortcuts work too ({k("#")}, {k("##")}, {k("-")}, {k("1.")}, {k("[]")}, {k(">")}).
        </p>
        <p>
          <strong>Section</strong> (Heading 1) and <strong>Subsection</strong> (Heading 2) are numbered 1, 1.1… and
          listed in the index. Everything saves as you type.
        </p>
      </>
    ),
  },
  {
    id: "index",
    route: (t) => open(docPage(t)),
    target: ".index-panel",
    placement: "left",
    title: "The index",
    body: <p>Every section and subsection of the page. It follows where you are as you scroll; click one to jump.</p>,
  },
  {
    id: "regions",
    route: (t) => (docPage(t)?.regions ? open(docPage(t)) : null),
    target: ".ann-block",
    title: "Annotated images",
    body: (
      <>
        <p>
          Drag on an image to draw a <strong>region</strong>; each gets a numbered comment. Drag a region to move it,
          its corner to resize.
        </p>
        <p>
          <strong>Link text</strong> on a comment, then select passages on the page. Hovering a comment, a region or a
          linked passage lights up all three.
        </p>
      </>
    ),
  },
  {
    id: "math-links",
    route: (t) => open(docPage(t)),
    target: ".material-doc .math-display, .material-doc .math-inline, .material-doc .mention",
    title: "Formulas and links",
    body: (
      <>
        <p>
          Type {k("$x^2$")} for a formula in a line, or {k("$$")} on an empty line for a formula block. Click one to
          edit its LaTeX.
        </p>
        <p>
          Type {k("@")} to link another page, slide, notebook or even one region of an image. Each material lists the
          pages that link to it under <strong>Linked from</strong>.
        </p>
      </>
    ),
  },
  {
    id: "page-menu",
    route: (t) => open(docPage(t)),
    target: '[title="More actions"]',
    placement: "bottom",
    title: "Page actions",
    body: (
      <p>
        <strong>Version history</strong> (earlier states, kept while you edit), <strong>Move to…</strong>,{" "}
        <strong>Export as Markdown</strong>, <strong>Print or save as PDF</strong> and <strong>Move to trash</strong>.
      </p>
    ),
  },
  {
    id: "view-menu",
    route: (t) => open(docPage(t)),
    target: '[title="Page view options"]',
    placement: "bottom",
    title: "View options",
    body: <p>Turn section numbers and the index on or off, and choose how linked passages are highlighted.</p>,
  },
  {
    id: "notebook",
    route: (t) => open(all(t).find((m) => m.kind === "notebook")),
    target: ".kernel-picker",
    placement: "bottom",
    title: "Notebooks",
    body: (
      <>
        <p>
          Code and markdown cells, like Jupyter. {k("Shift Enter")} runs a cell and moves on; {k("Esc")} gives
          command-mode keys (A/B insert, D D delete, M/Y switch type).
        </p>
        <p>
          Pick the kernel here: Python in the browser (nothing to install), or one of your own venv/conda
          environments.
        </p>
      </>
    ),
  },
  {
    id: "image-page",
    route: (t) => open(all(t).find((m) => m.kind === "image")),
    target: ".image-split",
    title: "Annotated image pages",
    body: (
      <p>
        One image fills the page with its comments beside it. Zoom with {k("+")} {k("-")} {k("0")}, drag the divider,
        and on imported slides step with {k("Page Up")} / {k("Page Down")}.
      </p>
    ),
  },
  {
    id: "canvas",
    sidebar: true,
    target: "[data-tour=canvas]",
    placement: "right",
    title: "Canvas",
    body: (
      <p>
        Freehand drawings and diagrams (Excalidraw). Draw on their own here, or type {k("/drawing")} in a page to draw
        and insert in one go.
      </p>
    ),
  },
  {
    id: "safety",
    sidebar: true,
    target: ".sidebar-bottom",
    placement: "right",
    title: "Nothing gets lost",
    body: (
      <p>
        Deleted things wait in the <strong>Trash</strong> for 30 days. The database is backed up each time the app
        starts; <strong>Backups and export</strong> has those backups, <strong>Back up now</strong> and a full export.
      </p>
    ),
  },
  {
    id: "done",
    sidebar: true,
    target: "[data-tour=tour]",
    placement: "right",
    title: "You're all set",
    body: <p>Replay this tour any time from here. The full guide is in the docs folder of the project.</p>,
  },
];
