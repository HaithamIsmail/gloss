// Messages between a notebook page and a kernel (browser worker or local Python).
import type { NotebookOutput } from "./pages";

export type KernelStatus = "disconnected" | "starting" | "idle" | "busy" | "dead";

export type ExecStatus = "ok" | "error" | "aborted";

/** Notebook page → kernel. */
export type KernelClientMsg =
  | { type: "execute"; id: string; code: string }
  | { type: "interrupt" }
  | { type: "restart" }
  | { type: "input_reply"; value: string };

/** Kernel → notebook page. `id` is the run id the page chose for a cell execution. */
export type KernelServerMsg =
  | { type: "status"; status: KernelStatus; message?: string }
  | { type: "info"; language: string; version: string; cwd?: string }
  | { type: "output"; id: string; output: NotebookOutput }
  | { type: "clear"; id: string; wait: boolean }
  | { type: "input_request"; id: string; prompt: string; password: boolean }
  | { type: "done"; id: string; status: ExecStatus; executionCount: number | null };

export type EnvKind = "conda" | "venv" | "pyenv" | "system";

/** A Python environment found on this computer (see server/envs.ts). */
export type PythonEnv = {
  /** Stable id: the interpreter path. */
  id: string;
  python: string;
  name: string;
  kind: EnvKind;
  version: string;
  prefix: string;
  hasIpykernel: boolean;
  custom: boolean;
};
