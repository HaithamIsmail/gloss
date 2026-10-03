import { asNotebook, type NotebookContent } from "../../shared/pages";
import { choiceLabel, type KernelChoice } from "./kernel";

/** nbformat stores multi-line text as a list of lines (each keeping its "\n"). */
const lines = (s: string) => (s ? s.split(/(?<=\n)/) : []);

export function toIpynb(nb: NotebookContent, kernel: KernelChoice): string {
  return JSON.stringify(
    {
      cells: nb.cells.map((c) =>
        c.cell_type === "code"
          ? {
              id: c.id,
              cell_type: "code",
              metadata: c.metadata,
              execution_count: c.execution_count,
              source: lines(c.source),
              outputs: c.outputs.map((o) => (o.output_type === "stream" ? { ...o, text: lines(Array.isArray(o.text) ? o.text.join("") : o.text) } : o)),
            }
          : {
              id: c.id,
              cell_type: c.cell_type,
              metadata: c.metadata,
              source: lines(c.source),
              ...(c.attachments ? { attachments: c.attachments } : {}),
            },
      ),
      metadata: {
        ...nb.metadata,
        kernelspec: { name: "python3", display_name: choiceLabel(kernel), language: "python" },
        language_info: { name: "python" },
      },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  );
}

export function downloadIpynb(nb: NotebookContent, kernel: KernelChoice, title: string) {
  const blob = new Blob([toIpynb(nb, kernel)], { type: "application/x-ipynb+json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(title || "notebook").replace(/[\\/:*?"<>|]+/g, "-")}.ipynb`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Reads a .ipynb file chosen by the user. */
export async function readIpynb(file: File): Promise<NotebookContent> {
  const raw = JSON.parse(await file.text());
  if (!raw || !Array.isArray(raw.cells)) throw new Error("This file is not a Jupyter notebook.");
  return asNotebook(raw);
}

export function pickIpynbFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ipynb,application/x-ipynb+json,application/json";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
