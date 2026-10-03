import "../../styles/notebook.css";

import {
  ArrowDown,
  ArrowUp,
  Code2,
  Download,
  Eraser,
  FastForward,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from "react";
import { useSearchParams } from "react-router";
import type { Material } from "../../../shared/api";
import type { ExecStatus } from "../../../shared/kernel";
import {
  asNotebook,
  headingId,
  markdownHeadings,
  newCell,
  notebookOutline,
  type NotebookCell,
  type NotebookContent,
  type NotebookOutput,
} from "../../../shared/pages";
import { useTree } from "../../api";
import { Backlinks } from "../../components/Backlinks";
import { IndexPanel } from "../../components/IndexPanel";
import { scrollToBlock } from "../../editor/links";
import { CodeEditor, type RunMode } from "../../notebook/CodeEditor";
import { downloadIpynb, pickIpynbFile, readIpynb } from "../../notebook/ipynb";
import { Kernel, PYODIDE, type KernelChoice } from "../../notebook/kernel";
import { KernelPicker } from "../../notebook/KernelPicker";
import { Outputs } from "../../notebook/Outputs";
import { renderMarkdown } from "../../notebook/render";
import { useUI } from "../../store";
import { isTyping, TitleInput, useContentSaver } from "./shared";

const LAST_KERNEL = "study-ws-last-kernel";

function rememberedChoice(nb: NotebookContent): KernelChoice {
  const saved = nb.metadata.study_kernel as KernelChoice | undefined;
  if (saved?.kind === "pyodide" || (saved?.kind === "local" && saved.python)) return saved;
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KERNEL) ?? "null") as KernelChoice | null;
    if (last?.kind) return last;
  } catch {
    /* ignore */
  }
  return PYODIDE;
}

/** Appends an output the way Jupyter does: consecutive stream chunks merge. */
function addOutput(outputs: NotebookOutput[], out: NotebookOutput): NotebookOutput[] {
  const last = outputs[outputs.length - 1];
  if (out.output_type === "stream" && last?.output_type === "stream" && last.name === out.name) {
    const text = (Array.isArray(last.text) ? last.text.join("") : last.text) + (Array.isArray(out.text) ? out.text.join("") : out.text);
    return [...outputs.slice(0, -1), { ...last, text }];
  }
  return [...outputs, out];
}

type InputReq = { prompt: string; password: boolean; submit: (v: string) => void };

type Actions = {
  select: (id: string) => void;
  edit: (id: string) => void;
  change: (id: string, source: string) => void;
  run: (id: string, mode: RunMode) => void;
  escape: (id: string) => void;
  insert: (id: string, where: "above" | "below", type: "code" | "markdown") => void;
  remove: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  setType: (id: string, type: "code" | "markdown") => void;
};

/** A Jupyter-style notebook page: code and markdown cells, run on a Python kernel. */
export default function NotebookView({ material }: { material: Material }) {
  const { data: tree } = useTree();
  const course = tree?.courses.find((c) => c.id === material.courseId);
  const showIndex = useUI((s) => s.prefs.showIndex);
  const numbering = useUI((s) => s.prefs.numbering);
  const { save } = useContentSaver(material.id, 800);

  const [nb, setNb] = useState(() => asNotebook(material.content));
  const nbRef = useRef(nb);
  const update = useCallback(
    (fn: (nb: NotebookContent) => NotebookContent) => {
      const next = fn(nbRef.current);
      nbRef.current = next;
      setNb(next);
      save(next);
    },
    [save],
  );
  const updateCell = useCallback(
    (id: string, fn: (c: NotebookCell) => NotebookCell) =>
      update((n) => ({ ...n, cells: n.cells.map((c) => (c.id === id ? fn(c) : c)) })),
    [update],
  );

  const [selected, setSelected] = useState<string | null>(nb.cells[0]?.id ?? null);
  const [mdEditing, setMdEditing] = useState<Set<string>>(() => new Set());
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [running, setRunning] = useState<Record<string, true>>({});
  const [inputs, setInputs] = useState<Record<string, InputReq>>({});
  const deleted = useRef<{ cell: NotebookCell; index: number }[]>([]);
  const pendingClear = useRef<Record<string, boolean>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Kernel ──────────────────────────────────────────────────────────────
  const [choice, setChoice] = useState<KernelChoice>(() => rememberedChoice(nb));
  const kernelRef = useRef<Kernel | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const ensureKernel = useCallback(() => {
    if (!kernelRef.current) {
      const k = new Kernel(choice, material.id);
      k.subscribe(bump);
      kernelRef.current = k;
      bump();
    }
    return kernelRef.current;
  }, [choice, material.id]);

  useEffect(() => () => kernelRef.current?.dispose(), []);

  const chooseKernel = (c: KernelChoice) => {
    kernelRef.current?.dispose();
    kernelRef.current = null;
    setRunning({});
    setInputs({});
    setChoice(c);
    try {
      localStorage.setItem(LAST_KERNEL, JSON.stringify(c));
    } catch {
      /* private mode */
    }
    update((n) => ({ ...n, metadata: { ...n.metadata, study_kernel: c } }));
  };

  const kernel = kernelRef.current;

  // ── Index (sections from markdown headings) ────────────────────────────
  const outline = useMemo(() => notebookOutline(nb), [nb]);
  useEffect(() => {
    useUI.getState().setDoc({ materialId: material.id, outline, regions: [], numbers: {}, linkCounts: {} });
  }, [material.id, outline]);

  // ── Running cells ───────────────────────────────────────────────────────
  const appendOutput = useCallback(
    (id: string, out: NotebookOutput) => {
      const clear = pendingClear.current[id];
      pendingClear.current[id] = false;
      updateCell(id, (c) => (c.cell_type === "code" ? { ...c, outputs: addOutput(clear ? [] : c.outputs, out) } : c));
    },
    [updateCell],
  );

  const runCell = useCallback(
    async (id: string): Promise<ExecStatus> => {
      const cell = nbRef.current.cells.find((c) => c.id === id);
      if (!cell) return "ok";
      if (cell.cell_type !== "code") {
        setMdEditing((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        return "ok";
      }
      if (!cell.source.trim()) return "ok";
      const k = ensureKernel();
      setRunning((s) => ({ ...s, [id]: true }));
      pendingClear.current[id] = true;
      const res = await k.execute(cell.source, {
        onOutput: (o) => appendOutput(id, o),
        onClear: (wait) => {
          if (wait) pendingClear.current[id] = true;
          else updateCell(id, (c) => (c.cell_type === "code" ? { ...c, outputs: [] } : c));
        },
        onInput: (prompt, password) =>
          new Promise<string>((resolve) =>
            setInputs((s) => ({
              ...s,
              [id]: {
                prompt,
                password,
                submit: (v) => {
                  setInputs(({ [id]: _done, ...rest }) => rest);
                  appendOutput(id, { output_type: "stream", name: "stdout", text: `${prompt}${password ? "••••" : v}\n` });
                  resolve(v);
                },
              },
            })),
          ),
      });
      setRunning(({ [id]: _done, ...rest }) => rest);
      setInputs(({ [id]: _done, ...rest }) => rest);
      // A cell that ran without printing anything still loses its old output.
      if (pendingClear.current[id] && res.status !== "aborted") {
        updateCell(id, (c) => (c.cell_type === "code" ? { ...c, outputs: [] } : c));
      }
      pendingClear.current[id] = false;
      if (res.executionCount !== null) {
        updateCell(id, (c) => (c.cell_type === "code" ? { ...c, execution_count: res.executionCount } : c));
      }
      return res.status;
    },
    [appendOutput, ensureKernel, updateCell],
  );

  const runAll = (from = 0) => {
    // Queue everything at once; the kernel skips the rest after an error.
    for (const c of nbRef.current.cells.slice(from)) if (c.cell_type === "code") void runCell(c.id);
  };

  // ── Cell editing ────────────────────────────────────────────────────────
  const focusCell = (id: string) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));

  const insert = useCallback(
    (id: string | null, where: "above" | "below", type: "code" | "markdown") => {
      const cell = newCell(type);
      update((n) => {
        const i = id ? n.cells.findIndex((c) => c.id === id) : n.cells.length - 1;
        const at = where === "above" ? Math.max(0, i) : i + 1;
        const cells = [...n.cells];
        cells.splice(at, 0, cell);
        return { ...n, cells };
      });
      setSelected(cell.id);
      if (type === "markdown") setMdEditing((s) => new Set(s).add(cell.id));
      focusCell(cell.id);
      return cell.id;
    },
    [update],
  );

  const actions = useRef<Actions>(null!) as MutableRefObject<Actions>;
  actions.current = {
    select: (id) => {
      if (id !== selected) {
        // Leaving a markdown cell renders it (an empty one stays editable).
        setMdEditing((s) => {
          if (!selected || !s.has(selected)) return s;
          const prev = nbRef.current.cells.find((c) => c.id === selected);
          if (!prev?.source.trim()) return s;
          const n = new Set(s);
          n.delete(selected);
          return n;
        });
      }
      setSelected(id);
    },
    edit: (id) => {
      setSelected(id);
      const cell = nbRef.current.cells.find((c) => c.id === id);
      if (cell?.cell_type !== "code") setMdEditing((s) => new Set(s).add(id));
      focusCell(id);
    },
    change: (id, source) => updateCell(id, (c) => ({ ...c, source })),
    run: (id, mode) => {
      void runCell(id);
      const cells = nbRef.current.cells;
      const i = cells.findIndex((c) => c.id === id);
      if (mode === "insert" || (mode === "next" && i === cells.length - 1)) insert(id, "below", "code");
      else if (mode === "next") {
        setSelected(cells[i + 1].id);
        if (cells[i + 1].cell_type === "code") focusCell(cells[i + 1].id);
        else containerRef.current?.querySelector<HTMLElement>(`[data-cell="${cells[i + 1].id}"]`)?.focus();
      }
    },
    escape: (id) => {
      setSelected(id);
      containerRef.current?.querySelector<HTMLElement>(`[data-cell="${id}"]`)?.focus();
    },
    insert: (id, where, type) => void insert(id, where, type),
    remove: (id) => {
      const cells = nbRef.current.cells;
      const index = cells.findIndex((c) => c.id === id);
      if (index < 0) return;
      deleted.current.push({ cell: cells[index], index });
      update((n) => ({ ...n, cells: n.cells.filter((c) => c.id !== id) }));
      const next = cells[index + 1] ?? cells[index - 1];
      setSelected(next?.id ?? null);
    },
    move: (id, dir) =>
      update((n) => {
        const i = n.cells.findIndex((c) => c.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= n.cells.length) return n;
        const cells = [...n.cells];
        [cells[i], cells[j]] = [cells[j], cells[i]];
        return { ...n, cells };
      }),
    setType: (id, type) => {
      updateCell(id, (c) => {
        if (c.cell_type === type) return c;
        return type === "code"
          ? { id: c.id, cell_type: "code", source: c.source, metadata: c.metadata, execution_count: null, outputs: [] }
          : { id: c.id, cell_type: "markdown", source: c.source, metadata: c.metadata };
      });
      if (type === "markdown") setMdEditing((s) => new Set(s).add(id));
    },
  };

  // Command mode (a cell is selected, no editor focused): Jupyter's keys.
  const lastD = useRef(0);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTyping(e.target) || !selected) return;
    const a = actions.current;
    const cells = nbRef.current.cells;
    const i = cells.findIndex((c) => c.id === selected);
    const key = e.key;
    const go = (j: number) => {
      const c = cells[Math.max(0, Math.min(cells.length - 1, j))];
      if (!c) return;
      a.select(c.id);
      containerRef.current?.querySelector<HTMLElement>(`[data-cell="${c.id}"]`)?.focus();
    };
    let handled = true;
    if (key === "Enter" && e.shiftKey) a.run(selected, "next");
    else if (key === "Enter" && (e.ctrlKey || e.metaKey)) a.run(selected, "stay");
    else if (key === "Enter" && e.altKey) a.run(selected, "insert");
    else if (key === "Enter") a.edit(selected);
    else if (key === "ArrowUp" || key === "k") go(i - 1);
    else if (key === "ArrowDown" || key === "j") go(i + 1);
    else if (key === "a") a.insert(selected, "above", "code");
    else if (key === "b") a.insert(selected, "below", "code");
    else if (key === "m") a.setType(selected, "markdown");
    else if (key === "y") a.setType(selected, "code");
    else if (key === "d") {
      if (Date.now() - lastD.current < 600) a.remove(selected);
      lastD.current = Date.now();
    } else if (key === "z" && deleted.current.length) {
      const { cell, index } = deleted.current.pop()!;
      update((n) => {
        const cells2 = [...n.cells];
        cells2.splice(Math.min(index, cells2.length), 0, cell);
        return { ...n, cells: cells2 };
      });
      setSelected(cell.id);
    } else handled = false;
    if (handled) e.preventDefault();
  };

  // ── Import / export ─────────────────────────────────────────────────────
  const importNotebook = async () => {
    const file = await pickIpynbFile();
    if (!file) return;
    try {
      const imported = await readIpynb(file);
      const hasContent = nbRef.current.cells.some((c) => c.source.trim());
      if (hasContent && !confirm(`Replace this notebook's cells with “${file.name}”?`)) return;
      update((n) => ({ ...imported, metadata: { ...imported.metadata, study_kernel: n.metadata.study_kernel } }));
      setSelected(imported.cells[0]?.id ?? null);
      setMdEditing(new Set());
    } catch (err) {
      alert((err as Error).message || "Could not read that notebook.");
    }
  };

  // Arriving from search: scroll to the cell or section.
  const [params, setParams] = useSearchParams();
  const blockParam = params.get("block");
  useEffect(() => {
    if (!blockParam) return;
    const t = window.setTimeout(() => {
      scrollToBlock(blockParam, { flash: true, block: "center" });
      const cellId = nbRef.current.cells.find((c) => blockParam === c.id || blockParam.startsWith(`${c.id}-h`))?.id;
      if (cellId) setSelected(cellId);
      setParams({}, { replace: true });
    }, 200);
    return () => window.clearTimeout(t);
  }, [blockParam, setParams]);

  const busy = Object.keys(running).length > 0;

  return (
    <div className={`material-page notebook-page${showIndex ? " has-index" : ""}`}>
      <div className="material-col nb-col">
        <div className="kicker">{[course?.code, course?.name, "Notebook"].filter(Boolean).join(" · ")}</div>
        <TitleInput material={material} />

        <div className="nb-toolbar">
          <button type="button" className="nb-tool" title="Run the selected cell (Shift+Enter)" onClick={() => selected && actions.current.run(selected, "next")}>
            <Play size={15} /> <span>Run</span>
          </button>
          <button type="button" className="nb-tool" title="Run all cells" onClick={() => runAll()}>
            <FastForward size={15} /> <span>Run all</span>
          </button>
          <button
            type="button"
            className="nb-tool"
            title={choice.kind === "pyodide" ? "The browser kernel can't be interrupted; restart it instead" : "Interrupt the kernel"}
            disabled={!busy || !kernel?.canInterrupt}
            onClick={() => kernel?.interrupt()}
          >
            <Square size={13} /> <span>Stop</span>
          </button>
          <button
            type="button"
            className="nb-tool"
            title="Restart the kernel (clears all variables)"
            disabled={!kernel}
            onClick={() => {
              if (!busy || confirm("Restart the kernel? Running cells will stop.")) {
                setRunning({});
                setInputs({});
                kernel?.restart();
              }
            }}
          >
            <RotateCcw size={14} /> <span>Restart</span>
          </button>
          <button
            type="button"
            className="nb-tool"
            title="Clear all outputs"
            onClick={() => update((n) => ({ ...n, cells: n.cells.map((c) => (c.cell_type === "code" ? { ...c, outputs: [], execution_count: null } : c)) }))}
          >
            <Eraser size={14} /> <span>Clear</span>
          </button>
          <span className="tool-sep" />
          <button type="button" className="nb-tool" title="Import a .ipynb file" onClick={() => void importNotebook()}>
            <Upload size={14} /> <span>Import</span>
          </button>
          <button type="button" className="nb-tool" title="Download as .ipynb" onClick={() => downloadIpynb(nbRef.current, choice, material.title)}>
            <Download size={14} /> <span>Export</span>
          </button>
          <span className="grow" />
          <KernelPicker
            choice={choice}
            status={kernel?.status ?? "idle"}
            message={kernel?.message ?? ""}
            started={!!kernel}
            cwd={kernel?.info?.cwd}
            onChoose={chooseKernel}
          />
        </div>

        <div
          ref={containerRef}
          className="nb-cells"
          data-numbering={numbering ? "on" : "off"}
          onKeyDown={onKeyDown}
        >
          {nb.cells.map((cell) => (
            <CellView
              key={cell.id}
              cell={cell}
              selected={selected === cell.id}
              editingMd={mdEditing.has(cell.id)}
              running={!!running[cell.id]}
              input={inputs[cell.id] ?? null}
              focusSignal={focus?.id === cell.id ? focus.n : 0}
              actions={actions}
            />
          ))}
          <div className="nb-add-end">
            <button type="button" onClick={() => void insert(null, "below", "code")}>
              <Plus size={14} /> Code
            </button>
            <button type="button" onClick={() => void insert(null, "below", "markdown")}>
              <Plus size={14} /> Markdown
            </button>
          </div>
        </div>
        <Backlinks materialId={material.id} />
      </div>
      {showIndex && <IndexPanel material={material} />}
    </div>
  );
}

const CellView = memo(function CellView({
  cell,
  selected,
  editingMd,
  running,
  input,
  focusSignal,
  actions,
}: {
  cell: NotebookCell;
  selected: boolean;
  editingMd: boolean;
  running: boolean;
  input: InputReq | null;
  focusSignal: number;
  actions: MutableRefObject<Actions>;
}) {
  const a = () => actions.current;
  const isCode = cell.cell_type === "code";
  const showEditor = isCode || editingMd;

  return (
    <div
      className={`nb-cell is-${cell.cell_type}${selected ? " is-selected" : ""}${running ? " is-running" : ""}`}
      data-cell={cell.id}
      data-outline-id={cell.id}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!selected) a().select(cell.id);
        // Clicking the cell's frame (not its editor or output) enters command mode.
        if (!(e.target as HTMLElement).closest(".cm-editor, .nb-outputs, button, input")) {
          (e.currentTarget as HTMLElement).focus();
        }
      }}
    >
      <div className="nb-gutter">
        {isCode ? (
          <button
            type="button"
            className="nb-run"
            title="Run this cell (Ctrl+Enter)"
            onClick={() => a().run(cell.id, "stay")}
          >
            {running ? <span className="nb-count">[*]</span> : (
              <>
                <span className="nb-count">[{cell.execution_count ?? " "}]</span>
                <Play size={13} className="nb-run-icon" />
              </>
            )}
          </button>
        ) : null}
      </div>

      <div className="nb-main">
        {showEditor ? (
          <div className="nb-editor" onDoubleClick={(e) => e.stopPropagation()}>
            <CodeEditor
              value={cell.source}
              language={isCode ? "python" : "markdown"}
              onChange={(v) => a().change(cell.id, v)}
              onRun={(mode) => a().run(cell.id, mode)}
              onEscape={() => a().escape(cell.id)}
              onFocus={() => a().select(cell.id)}
              focusSignal={focusSignal}
              autoFocus={focusSignal > 0}
              placeholder={isCode ? "" : "Markdown: # Section, ## Subsection, **bold**, $math$ … Shift+Enter to render"}
            />
          </div>
        ) : (
          <MarkdownView cell={cell} onEdit={() => a().edit(cell.id)} />
        )}
        {isCode && <Outputs outputs={cell.outputs} input={input} />}
      </div>

      <div className="nb-cell-tools">
        <button type="button" title="Move up" onClick={() => a().move(cell.id, -1)}>
          <ArrowUp size={14} />
        </button>
        <button type="button" title="Move down" onClick={() => a().move(cell.id, 1)}>
          <ArrowDown size={14} />
        </button>
        <button
          type="button"
          title={isCode ? "Make markdown (M)" : "Make code (Y)"}
          onClick={() => a().setType(cell.id, isCode ? "markdown" : "code")}
        >
          {isCode ? <Type size={14} /> : <Code2 size={14} />}
        </button>
        <button type="button" title="Delete (D, D) · Z restores" onClick={() => a().remove(cell.id)}>
          <Trash2 size={14} />
        </button>
      </div>

      <div className="nb-insert">
        <button type="button" onClick={() => a().insert(cell.id, "below", "code")}>
          <Plus size={12} /> Code
        </button>
        <button type="button" onClick={() => a().insert(cell.id, "below", "markdown")}>
          <Plus size={12} /> Markdown
        </button>
      </div>
    </div>
  );
});

function MarkdownView({ cell, onEdit }: { cell: NotebookCell; onEdit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () => renderMarkdown(cell.source, cell.cell_type === "markdown" ? cell.attachments : undefined),
    [cell],
  );

  // Tag section headings so the index and search can scroll to them.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const count = markdownHeadings(cell.source).length;
    el.querySelectorAll("h1, h2").forEach((h, k) => {
      if (k < count) h.setAttribute("data-outline-id", headingId(cell.id, k));
    });
  }, [html, cell.id, cell.source]);

  if (!cell.source.trim()) {
    return (
      <div className="nb-md is-empty" onDoubleClick={onEdit}>
        Empty markdown cell · double-click to write
      </div>
    );
  }
  return <div ref={ref} className="nb-md" onDoubleClick={onEdit} dangerouslySetInnerHTML={{ __html: html }} />;
}
