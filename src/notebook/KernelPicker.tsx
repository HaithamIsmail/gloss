import { Check, ChevronDown, Cpu, FolderOpen, Globe, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KernelStatus, PythonEnv } from "../../shared/kernel";
import { api, keys, queryClient, useEnvs } from "../api";
import { choiceLabel, PYODIDE, type KernelChoice } from "./kernel";

const KIND_LABEL: Record<PythonEnv["kind"], string> = {
  conda: "Conda",
  venv: "Virtual env",
  pyenv: "pyenv",
  system: "System",
};

const STATUS_LABEL: Record<KernelStatus, string> = {
  disconnected: "Disconnected",
  starting: "Starting…",
  idle: "Idle",
  busy: "Busy",
  dead: "Stopped",
};

export function KernelPicker({
  choice,
  status,
  message,
  started,
  cwd,
  onChoose,
}: {
  choice: KernelChoice;
  status: KernelStatus;
  message: string;
  started: boolean;
  cwd?: string;
  onChoose: (c: KernelChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: envs, isFetching } = useEnvs(open);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState<{ python: string; ok: boolean; log: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addPath, setAddPath] = useState("");
  const [addError, setAddError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (c: KernelChoice) => {
    onChoose(c);
    setOpen(false);
  };

  const install = async (env: PythonEnv) => {
    if (!confirm(`Install ipykernel into “${env.name}” with pip?\n\n${env.python} -m pip install ipykernel`)) return;
    setInstalling(env.python);
    setInstallLog(null);
    try {
      const res = await api.installIpykernel(env.python);
      setInstallLog({ python: env.python, ...res });
      const fresh = await api.envs(true);
      queryClient.setQueryData(keys.envs, fresh);
      if (res.ok) choose({ kind: "local", python: env.python, name: env.name });
    } catch (err) {
      setInstallLog({ python: env.python, ok: false, log: String((err as Error).message) });
    } finally {
      setInstalling(null);
    }
  };

  const add = async () => {
    setAddError("");
    try {
      const env = await api.addEnv(addPath);
      queryClient.setQueryData<PythonEnv[]>(keys.envs, (list) =>
        list?.some((e) => e.python === env.python) ? list : [...(list ?? []), env],
      );
      setAdding(false);
      setAddPath("");
      if (env.hasIpykernel) choose({ kind: "local", python: env.python, name: env.name });
    } catch (err) {
      setAddError(String((err as Error).message).replace(/^.*?\d{3}\)\s*/, "").replace(/^\{"error":"|"\}$/g, ""));
    }
  };

  const shownStatus = started ? STATUS_LABEL[status] : "Not started";

  return (
    <div className="kernel-picker" ref={ref}>
      <button type="button" className={`kernel-btn${open ? " is-open" : ""}`} onClick={() => setOpen((o) => !o)}>
        {choice.kind === "pyodide" ? <Globe size={15} /> : <Cpu size={15} />}
        <span className="kernel-name">{choiceLabel(choice)}</span>
        <span className={`kernel-dot is-${started ? status : "off"}`} />
        <span className="kernel-status" title={message || undefined}>
          {message && (status === "busy" || status === "starting" || status === "dead") ? message : shownStatus}
        </span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="kernel-pop">
          <div className="menu-label">In the browser</div>
          <button type="button" className="kernel-opt" onClick={() => choose(PYODIDE)}>
            <span className="check-slot">{choice.kind === "pyodide" && <Check size={14} />}</span>
            <span className="kernel-opt-main">
              <strong>Python in the browser</strong>
              <small>Pyodide · nothing to install · numpy, pandas, matplotlib, scikit-learn…</small>
            </span>
          </button>

          <div className="menu-label kernel-section">
            <span>On this computer</span>
            <button type="button" className="icon-btn small" title="Search again" onClick={() => void api.envs(true).then((e) => queryClient.setQueryData(keys.envs, e))}>
              <RefreshCw size={13} className={isFetching ? "spin" : undefined} />
            </button>
          </div>
          {!envs && <div className="kernel-empty"><LoaderCircle size={14} className="spin" /> Looking for Python environments…</div>}
          {envs && !envs.length && <div className="kernel-empty">No Python found. Install Python or conda, or add an interpreter below.</div>}
          {envs?.map((env) => {
            const selected = choice.kind === "local" && choice.python === env.python;
            return (
              <div key={env.python} className="kernel-opt-row">
                <button
                  type="button"
                  className="kernel-opt"
                  disabled={!env.hasIpykernel}
                  title={env.python}
                  onClick={() => choose({ kind: "local", python: env.python, name: env.name })}
                >
                  <span className="check-slot">{selected && <Check size={14} />}</span>
                  <span className="kernel-opt-main">
                    <strong>
                      {env.name} <span className="kernel-tag">{KIND_LABEL[env.kind]}</span>
                    </strong>
                    <small>
                      Python {env.version} · {env.python}
                    </small>
                  </span>
                </button>
                {!env.hasIpykernel && (
                  <button type="button" className="kernel-install" disabled={!!installing} onClick={() => void install(env)}>
                    {installing === env.python ? <LoaderCircle size={13} className="spin" /> : null}
                    {installing === env.python ? "Installing…" : "Install ipykernel"}
                  </button>
                )}
              </div>
            );
          })}
          {installLog && (
            <pre className={`kernel-log${installLog.ok ? "" : " is-error"}`}>
              {installLog.ok ? "ipykernel installed.\n" : "Install failed:\n"}
              {installLog.log}
            </pre>
          )}

          {adding ? (
            <div className="kernel-add">
              <input
                autoFocus
                value={addPath}
                placeholder={navigator.platform.startsWith("Win") ? "C:\\path\\to\\env  or  …\\python.exe" : "/path/to/env  or  …/bin/python"}
                onChange={(e) => setAddPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void add()}
              />
              <button type="button" className="btn-primary small" onClick={() => void add()}>
                Add
              </button>
              {addError && <div className="kernel-add-error">{addError}</div>}
            </div>
          ) : (
            <button type="button" className="kernel-opt muted-opt" onClick={() => setAdding(true)}>
              <span className="check-slot">
                <Plus size={14} />
              </span>
              <span className="kernel-opt-main">
                <strong>Add an interpreter…</strong>
                <small>A venv or conda folder, or a python executable</small>
              </span>
            </button>
          )}

          {choice.kind === "local" && cwd && (
            <div className="kernel-cwd" title="The kernel's working folder: put data files here to open them by name">
              <FolderOpen size={13} /> <code>{cwd}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
