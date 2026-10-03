// Client side of a notebook kernel. Both kinds speak the same messages
// (shared/kernel.ts): the browser kernel through a Web Worker, local Python
// environments through a WebSocket to the server, which runs ipykernel.
import type { ExecStatus, KernelClientMsg, KernelServerMsg, KernelStatus } from "../../shared/kernel";
import type { NotebookOutput } from "../../shared/pages";

export type KernelChoice = { kind: "pyodide" } | { kind: "local"; python: string; name: string };

export const PYODIDE: KernelChoice = { kind: "pyodide" };

export const choiceLabel = (c: KernelChoice) => (c.kind === "pyodide" ? "Python in the browser" : c.name);

export type RunHandlers = {
  onOutput: (output: NotebookOutput) => void;
  onClear: (wait: boolean) => void;
  onInput: (prompt: string, password: boolean) => Promise<string>;
};

export type RunResult = { status: ExecStatus; executionCount: number | null };

interface Transport {
  send(msg: KernelClientMsg): void;
  close(): void;
}

let runCounter = 0;

export class Kernel {
  status: KernelStatus = "starting";
  message = "";
  info: { version: string; cwd?: string } | null = null;
  readonly canInterrupt: boolean;
  private transport!: Transport;
  private runs = new Map<string, { h: RunHandlers; resolve: (r: RunResult) => void }>();
  private listeners = new Set<() => void>();
  private disposed = false;
  private retry = 0;

  constructor(
    readonly choice: KernelChoice,
    private materialId: string,
  ) {
    this.canInterrupt = choice.kind === "local";
    this.connect();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  private setStatus(status: KernelStatus, message = "") {
    this.status = status;
    this.message = message;
    this.changed();
  }

  private connect() {
    if (this.choice.kind === "pyodide") {
      const worker = new Worker(new URL("./pyodide.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<KernelServerMsg>) => this.handle(e.data);
      worker.onerror = (e) => this.setStatus("dead", e.message || "The browser kernel crashed.");
      this.transport = { send: (m) => worker.postMessage(m), close: () => worker.terminate() };
      return;
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const qs = new URLSearchParams({ material: this.materialId, python: this.choice.python });
    const ws = new WebSocket(`${proto}://${location.host}/api/kernels/ws?${qs}`);
    const outbox: KernelClientMsg[] = [];
    ws.onopen = () => {
      this.retry = 0;
      for (const m of outbox.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)));
    ws.onclose = () => {
      if (this.disposed) return;
      this.abortAll();
      this.setStatus("disconnected", "Lost the connection to the kernel. Reconnecting…");
      // The server keeps the kernel running, so reconnecting resumes it.
      const delay = Math.min(10_000, 1000 * 2 ** this.retry++);
      window.setTimeout(() => !this.disposed && this.connect(), delay);
    };
    this.transport = {
      send: (m) => (ws.readyState === WebSocket.OPEN ? ws.send(JSON.stringify(m)) : outbox.push(m)),
      close: () => ws.close(),
    };
  }

  private handle(msg: KernelServerMsg) {
    switch (msg.type) {
      case "status":
        this.setStatus(msg.status, msg.message);
        if (msg.status === "dead") this.abortAll();
        break;
      case "info":
        this.info = { version: msg.version, cwd: msg.cwd };
        this.changed();
        break;
      case "output":
        this.runs.get(msg.id)?.h.onOutput(msg.output);
        break;
      case "clear":
        this.runs.get(msg.id)?.h.onClear(msg.wait);
        break;
      case "input_request": {
        const run = this.runs.get(msg.id);
        if (run) void run.h.onInput(msg.prompt, msg.password).then((value) => this.transport.send({ type: "input_reply", value }));
        break;
      }
      case "done": {
        const run = this.runs.get(msg.id);
        this.runs.delete(msg.id);
        run?.resolve({ status: msg.status, executionCount: msg.executionCount });
        break;
      }
    }
  }

  private abortAll() {
    for (const run of this.runs.values()) run.resolve({ status: "aborted", executionCount: null });
    this.runs.clear();
  }

  execute(code: string, h: RunHandlers): Promise<RunResult> {
    const id = `r${++runCounter}`;
    return new Promise((resolve) => {
      this.runs.set(id, { h, resolve });
      this.transport.send({ type: "execute", id, code });
    });
  }

  interrupt() {
    if (this.canInterrupt) this.transport.send({ type: "interrupt" });
  }

  restart() {
    this.abortAll();
    if (this.choice.kind === "pyodide") {
      // The browser kernel cannot be interrupted; a fresh worker is the reset.
      this.transport.close();
      this.info = null;
      this.setStatus("starting");
      this.connect();
    } else {
      this.transport.send({ type: "restart" });
    }
  }

  dispose() {
    this.disposed = true;
    this.abortAll();
    this.transport.close();
    this.listeners.clear();
  }
}
