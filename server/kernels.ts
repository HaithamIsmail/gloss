// Runs real Jupyter kernels (ipykernel) in the user's Python environments and
// bridges them to notebook pages over a WebSocket. Speaks the Jupyter messaging
// protocol (v5) to the kernel over ZeroMQ, as JupyterLab and VS Code do.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocket } from "ws";
import * as zmq from "zeromq";
import type { ExecStatus, KernelClientMsg, KernelServerMsg, KernelStatus } from "../shared/kernel";
import type { NotebookOutput } from "../shared/pages";
import { DATA_DIR } from "./db";
import { activationEnv, type PythonEnv } from "./envs";

const WRAPPER = fileURLToPath(new URL("./kernel_wrapper.py", import.meta.url));
const DELIM = "<IDS|MSG>";
const IDLE_SHUTDOWN_MS = 15 * 60_000;
const START_TIMEOUT_MS = 90_000;

type JMsg = {
  header: { msg_id: string; msg_type: string; [k: string]: unknown };
  parent_header: { msg_id?: string; [k: string]: unknown };
  metadata: Record<string, unknown>;
  content: Record<string, any>;
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** One ZeroMQ socket with sends queued (zeromq allows one send in flight per socket). */
class Channel<S extends zmq.Dealer | zmq.Subscriber> {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly sock: S) {}
  send(frames: (string | Buffer)[]) {
    const p = this.chain.then(() => (this.sock as zmq.Dealer).send(frames));
    this.chain = p.catch(() => undefined);
    return p;
  }
}

type Execution = { runId: string; reply?: { status: ExecStatus; execution_count: number | null }; idle: boolean };

export class KernelSession {
  status: KernelStatus = "starting";
  message = "";
  readonly clients = new Set<WebSocket>();
  readonly cwd: string;
  private proc?: ChildProcessWithoutNullStreams;
  private key = "";
  private session = crypto.randomUUID();
  private shell?: Channel<zmq.Dealer>;
  private control?: Channel<zmq.Dealer>;
  private stdin?: Channel<zmq.Dealer>;
  private iopub?: zmq.Subscriber;
  private connectionFile = "";
  private executions = new Map<string, Execution>();
  private waiting: { runId: string; code: string }[] = [];
  private pendingInput: { header: JMsg["header"]; runId: string } | null = null;
  private infoWaiter: ((ok: boolean) => void) | null = null;
  private stderrTail: string[] = [];
  private idleTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    readonly materialId: string,
    readonly env: PythonEnv,
  ) {
    this.cwd = path.join(DATA_DIR, "notebooks", materialId);
    fs.mkdirSync(this.cwd, { recursive: true });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start() {
    this.stopped = false;
    this.setStatus("starting", `Starting ${this.env.name}…`);
    const [shell, iopub, stdin, control, hb] = await Promise.all([1, 2, 3, 4, 5].map(freePort));
    this.key = crypto.randomBytes(32).toString("hex");
    this.session = crypto.randomUUID();
    const dir = path.join(os.tmpdir(), "study-workspace-kernels");
    fs.mkdirSync(dir, { recursive: true });
    this.connectionFile = path.join(dir, `kernel-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      this.connectionFile,
      JSON.stringify({
        shell_port: shell,
        iopub_port: iopub,
        stdin_port: stdin,
        control_port: control,
        hb_port: hb,
        ip: "127.0.0.1",
        key: this.key,
        transport: "tcp",
        signature_scheme: "hmac-sha256",
        kernel_name: "",
      }),
    );

    const proc = spawn(this.env.python, [WRAPPER, this.connectionFile], {
      cwd: this.cwd,
      env: activationEnv(this.env),
      windowsHide: true,
    });
    this.proc = proc;
    proc.stderr.on("data", (d: Buffer) => {
      this.stderrTail.push(...d.toString().split(/\r?\n/).filter(Boolean));
      this.stderrTail = this.stderrTail.slice(-30);
    });
    proc.stdout.on("data", () => undefined);
    proc.on("exit", () => {
      if (this.proc !== proc) return;
      this.closeSockets();
      if (!this.stopped) {
        const why = this.stderrTail.filter((l) => /Error|error|No module/.test(l)).slice(-3).join("\n");
        this.failAll();
        this.setStatus("dead", why || "The kernel stopped.");
      }
    });

    const url = (port: number) => `tcp://127.0.0.1:${port}`;
    const routingId = `study-${this.session}`;
    const shellSock = new zmq.Dealer({ routingId });
    const controlSock = new zmq.Dealer({ routingId });
    const stdinSock = new zmq.Dealer({ routingId });
    const iopubSock = new zmq.Subscriber();
    shellSock.connect(url(shell));
    controlSock.connect(url(control));
    stdinSock.connect(url(stdin));
    iopubSock.connect(url(iopub));
    iopubSock.subscribe();
    this.shell = new Channel(shellSock);
    this.control = new Channel(controlSock);
    this.stdin = new Channel(stdinSock);
    this.iopub = iopubSock;
    void this.listen(shellSock, (m) => this.onShell(m));
    void this.listen(controlSock, () => undefined);
    void this.listen(stdinSock, (m) => this.onStdin(m));
    void this.listen(iopubSock, (m) => this.onIopub(m));

    // The kernel binds its ports a moment after starting; ask until it answers.
    const ready = await new Promise<boolean>((resolve) => {
      const deadline = Date.now() + START_TIMEOUT_MS;
      this.infoWaiter = resolve;
      const ask = () => {
        if (!this.infoWaiter || this.proc !== proc) return;
        if (Date.now() > deadline || proc.exitCode !== null) return resolve(false);
        void this.send(this.shell!, "kernel_info_request", {});
        setTimeout(ask, 1500);
      };
      ask();
    });
    this.infoWaiter = null;
    if (!ready) {
      if (this.status !== "dead") {
        const why = this.stderrTail.slice(-3).join("\n");
        this.setStatus("dead", why || "The kernel did not start in time.");
      }
      this.stop();
      return;
    }
    this.setStatus("idle");
    for (const job of this.waiting.splice(0)) await this.execute(job.runId, job.code);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.idleTimer);
    this.failAll();
    const proc = this.proc;
    this.proc = undefined;
    if (proc && proc.exitCode === null) {
      try {
        proc.stdin.write("kill\n");
      } catch {
        /* already gone */
      }
      setTimeout(() => proc.exitCode === null && proc.kill(), 2000);
    }
    this.closeSockets();
    fs.rm(this.connectionFile, { force: true }, () => undefined);
  }

  async restart() {
    this.stop();
    await this.start();
  }

  interrupt() {
    try {
      this.proc?.stdin.write("interrupt\n");
    } catch {
      /* not running */
    }
  }

  // ── Clients ─────────────────────────────────────────────────────────────

  attach(ws: WebSocket) {
    clearTimeout(this.idleTimer);
    this.clients.add(ws);
    this.sendTo(ws, { type: "info", language: "python", version: this.env.version, cwd: this.cwd });
    this.sendTo(ws, { type: "status", status: this.status, message: this.message });
    ws.on("message", (raw) => {
      let msg: KernelClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "execute") void this.execute(msg.id, msg.code);
      else if (msg.type === "interrupt") this.interrupt();
      else if (msg.type === "restart") void this.restart();
      else if (msg.type === "input_reply") this.inputReply(msg.value);
    });
    ws.on("close", () => {
      this.clients.delete(ws);
      if (!this.clients.size) {
        this.idleTimer = setTimeout(() => sessions.delete(this.materialId) && this.stop(), IDLE_SHUTDOWN_MS);
      }
    });
  }

  private sendTo(ws: WebSocket, msg: KernelServerMsg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: KernelServerMsg) {
    for (const ws of this.clients) this.sendTo(ws, msg);
  }

  private setStatus(status: KernelStatus, message = "") {
    this.status = status;
    this.message = message;
    this.broadcast({ type: "status", status, message });
  }

  // ── Execution ───────────────────────────────────────────────────────────

  private async execute(runId: string, code: string) {
    // Cells run while the kernel is still starting wait for it.
    if (this.status === "starting") {
      this.waiting.push({ runId, code });
      return;
    }
    if (!this.shell || this.status === "dead") {
      this.broadcast({ type: "done", id: runId, status: "aborted", executionCount: null });
      return;
    }
    const msgId = crypto.randomUUID();
    this.executions.set(msgId, { runId, idle: false });
    await this.send(
      this.shell,
      "execute_request",
      { code, silent: false, store_history: true, user_expressions: {}, allow_stdin: true, stop_on_error: true },
      {},
      msgId,
    );
  }

  private inputReply(value: string) {
    const pending = this.pendingInput;
    if (!pending || !this.stdin) return;
    this.pendingInput = null;
    void this.send(this.stdin, "input_reply", { value }, pending.header);
  }

  private finishIfDone(msgId: string) {
    const ex = this.executions.get(msgId);
    if (!ex || !ex.reply || !ex.idle) return;
    this.executions.delete(msgId);
    this.broadcast({ type: "done", id: ex.runId, status: ex.reply.status, executionCount: ex.reply.execution_count });
  }

  private failAll() {
    for (const ex of [...this.executions.values(), ...this.waiting]) {
      this.broadcast({ type: "done", id: ex.runId, status: "aborted", executionCount: null });
    }
    this.executions.clear();
    this.waiting = [];
    this.pendingInput = null;
  }

  private onShell(m: JMsg) {
    if (m.header.msg_type === "kernel_info_reply") {
      this.infoWaiter?.(true);
      return;
    }
    if (m.header.msg_type !== "execute_reply") return;
    const id = m.parent_header.msg_id ?? "";
    const ex = this.executions.get(id);
    if (!ex) return;
    ex.reply = { status: m.content.status, execution_count: m.content.execution_count ?? null };
    this.finishIfDone(id);
  }

  private onStdin(m: JMsg) {
    if (m.header.msg_type !== "input_request") return;
    const ex = this.executions.get(m.parent_header.msg_id ?? "");
    if (!ex) return;
    this.pendingInput = { header: m.header, runId: ex.runId };
    this.broadcast({
      type: "input_request",
      id: ex.runId,
      prompt: String(m.content.prompt ?? ""),
      password: !!m.content.password,
    });
  }

  private onIopub(m: JMsg) {
    const type = m.header.msg_type;
    const parentId = m.parent_header.msg_id ?? "";
    const ex = this.executions.get(parentId);
    const c = m.content;

    if (type === "status") {
      if (this.status === "starting") return;
      const state = c.execution_state;
      if (state === "busy" || state === "idle") this.setStatus(state);
      if (ex && state === "idle") {
        ex.idle = true;
        this.finishIfDone(parentId);
      }
      return;
    }
    if (!ex) return;

    let output: NotebookOutput | null = null;
    if (type === "stream") output = { output_type: "stream", name: c.name, text: c.text };
    else if (type === "execute_result")
      output = { output_type: "execute_result", execution_count: c.execution_count ?? null, data: c.data, metadata: c.metadata ?? {} };
    else if (type === "display_data" || type === "update_display_data")
      output = { output_type: "display_data", data: c.data, metadata: c.metadata ?? {} };
    else if (type === "error")
      output = { output_type: "error", ename: c.ename, evalue: c.evalue, traceback: c.traceback ?? [] };
    else if (type === "clear_output") {
      this.broadcast({ type: "clear", id: ex.runId, wait: !!c.wait });
      return;
    }
    if (output) this.broadcast({ type: "output", id: ex.runId, output });
  }

  // ── Wire format ─────────────────────────────────────────────────────────

  private sign(parts: string[]) {
    const h = crypto.createHmac("sha256", this.key);
    for (const p of parts) h.update(p);
    return h.digest("hex");
  }

  private send(
    ch: Channel<zmq.Dealer>,
    msgType: string,
    content: object,
    parent: object = {},
    msgId: string = crypto.randomUUID(),
  ) {
    const header = {
      msg_id: msgId,
      username: "study",
      session: this.session,
      date: new Date().toISOString(),
      msg_type: msgType,
      version: "5.3",
    };
    const parts = [JSON.stringify(header), JSON.stringify(parent), "{}", JSON.stringify(content)];
    return ch.send([DELIM, this.sign(parts), ...parts]).catch(() => undefined);
  }

  private async listen(sock: zmq.Dealer | zmq.Subscriber, handle: (m: JMsg) => void) {
    try {
      for await (const frames of sock) {
        const i = frames.findIndex((f) => f.toString() === DELIM);
        if (i < 0 || frames.length < i + 6) continue;
        const [sig, h, p, md, c] = frames.slice(i + 1, i + 6).map((f) => f.toString());
        if (sig !== this.sign([h, p, md, c])) continue; // not from our kernel
        try {
          handle({ header: JSON.parse(h), parent_header: JSON.parse(p), metadata: JSON.parse(md), content: JSON.parse(c) });
        } catch (err) {
          console.error("kernel message", err);
        }
      }
    } catch {
      /* socket closed */
    }
  }

  private closeSockets() {
    for (const ch of [this.shell, this.control, this.stdin]) {
      try {
        ch?.sock.close();
      } catch {
        /* closed */
      }
    }
    try {
      this.iopub?.close();
    } catch {
      /* closed */
    }
    this.shell = this.control = this.stdin = undefined;
    this.iopub = undefined;
  }
}

/** One kernel per notebook page, kept alive across reloads until idle for a while. */
const sessions = new Map<string, KernelSession>();

export function connectKernel(ws: WebSocket, materialId: string, env: PythonEnv) {
  let session = sessions.get(materialId);
  if (session && session.env.python !== env.python) {
    session.stop();
    sessions.delete(materialId);
    session = undefined;
  }
  if (!session) {
    session = new KernelSession(materialId, env);
    sessions.set(materialId, session);
    session.attach(ws);
    void session.start();
  } else {
    session.attach(ws);
  }
}

export function shutdownAllKernels() {
  for (const s of sessions.values()) s.stop();
  sessions.clear();
}
