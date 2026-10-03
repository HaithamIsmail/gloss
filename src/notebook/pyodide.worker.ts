/// <reference lib="webworker" />
// The browser kernel: Python (Pyodide) in a Web Worker, speaking the same
// messages as a local Jupyter kernel does through the server.
import type { ExecStatus, KernelClientMsg, KernelServerMsg } from "../../shared/kernel";
import type { NotebookOutput } from "../../shared/pages";
import BOOT from "./boot.py?raw";

declare const self: DedicatedWorkerGlobalScope;

type PyodideLike = {
  version: string;
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
  registerJsModule: (name: string, module: object) => void;
  setStdin: (opts: { error: boolean }) => void;
  loadPackagesFromImports: (code: string, opts: { messageCallback?: (m: string) => void }) => Promise<unknown>;
  globals: { get: (name: string) => (code: string) => Promise<boolean> };
};

const post = (msg: KernelServerMsg) => self.postMessage(msg);

let py: PyodideLike | null = null;
let current: string | null = null;
let count = 0;
const queue: { id: string; code: string }[] = [];
let running = false;

function emit(kind: string, json: string) {
  const id = current;
  if (!id) return;
  const p = JSON.parse(json);
  let output: NotebookOutput | null = null;
  if (kind === "stream") output = { output_type: "stream", name: p.name, text: p.text };
  else if (kind === "display") output = { output_type: "display_data", data: p, metadata: {} };
  else if (kind === "result") output = { output_type: "execute_result", execution_count: count, data: p, metadata: {} };
  else if (kind === "error") output = { output_type: "error", ename: p.ename, evalue: p.evalue, traceback: p.traceback };
  else if (kind === "clear") return post({ type: "clear", id, wait: !!p.wait });
  if (output) post({ type: "output", id, output });
}

const booted = (async () => {
  post({ type: "status", status: "starting", message: "Loading Python in the browser…" });
  const origin = self.location.origin;
  const mod = await import(/* @vite-ignore */ `${origin}/pyodide/pyodide.mjs`);
  // The runtime comes from our server; extra packages (numpy, pandas, …) from the Pyodide CDN.
  py = (await mod.loadPyodide({
    indexURL: `${origin}/pyodide/`,
    packageBaseUrl: `https://cdn.jsdelivr.net/pyodide/v${mod.version}/full/`,
  })) as PyodideLike;
  py.setStdin({ error: true });
  py.registerJsModule("_study", { emit });
  await py.runPythonAsync(BOOT);
  post({ type: "info", language: "python", version: `${py.runPython("import sys; '%d.%d.%d' % sys.version_info[:3]")}` });
  post({ type: "status", status: "idle" });
})().catch((err) => {
  post({ type: "status", status: "dead", message: `Python could not load: ${String(err?.message ?? err)}` });
  throw err;
});

async function runNext() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  try {
    await booted;
  } catch {
    running = false;
    post({ type: "done", id: job.id, status: "aborted", executionCount: null });
    return runNext();
  }
  current = job.id;
  count++;
  post({ type: "status", status: "busy" });
  let status: ExecStatus = "ok";
  try {
    await py!.loadPackagesFromImports(job.code, {
      messageCallback: (m) => post({ type: "status", status: "busy", message: m }),
    });
    post({ type: "status", status: "busy" });
    const ok = await py!.globals.get("_study_run")(job.code);
    status = ok ? "ok" : "error";
  } catch (err) {
    emit("error", JSON.stringify({ ename: "Error", evalue: String((err as Error)?.message ?? err), traceback: [] }));
    status = "error";
  }
  post({ type: "done", id: job.id, status, executionCount: count });
  current = null;
  // Like Jupyter: after an error, cells queued behind it are skipped.
  if (status === "error") {
    for (const j of queue.splice(0)) post({ type: "done", id: j.id, status: "aborted", executionCount: null });
  }
  running = false;
  if (!queue.length) post({ type: "status", status: "idle" });
  void runNext();
}

self.onmessage = (e: MessageEvent<KernelClientMsg>) => {
  const msg = e.data;
  if (msg.type === "execute") {
    queue.push({ id: msg.id, code: msg.code });
    void runNext();
  }
  // interrupt/restart are handled by the page, which terminates this worker.
};
