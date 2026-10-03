// Finds Python environments on this machine (conda, venv, pyenv, system), the
// way VS Code's Python extension does, so a notebook can pick one as its kernel.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvKind, PythonEnv } from "../shared/kernel";
import { getSetting, setSetting } from "./db";

export type { EnvKind, PythonEnv };

const isWin = process.platform === "win32";
const home = os.homedir();
const CUSTOM_KEY = "customPythons";

type RunResult = { code: number; stdout: string; stderr: string };

export function run(file: string, args: string[], opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<RunResult>((resolve) => {
    execFile(
      file,
      args,
      { timeout: opts.timeout ?? 10_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: opts.env },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

const PROBE =
  "import sys, os, json, importlib.util as u; print(json.dumps({" +
  "'executable': sys.executable, 'version': '%d.%d.%d' % sys.version_info[:3], " +
  "'prefix': sys.prefix, 'base_prefix': getattr(sys, 'base_prefix', sys.prefix), " +
  "'conda': os.path.exists(os.path.join(sys.prefix, 'conda-meta')), " +
  "'ipykernel': u.find_spec('ipykernel') is not None}))";

type Probe = {
  executable: string;
  version: string;
  prefix: string;
  base_prefix: string;
  conda: boolean;
  ipykernel: boolean;
};

async function probe(python: string): Promise<Probe | null> {
  const res = await run(python, ["-c", PROBE], { timeout: 15_000 });
  if (res.code !== 0) return null;
  try {
    const line = res.stdout.trim().split(/\r?\n/).pop() ?? "";
    return JSON.parse(line) as Probe;
  } catch {
    return null;
  }
}

const exists = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const subdirs = (dir: string) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
};

/** The interpreter inside an environment folder, if there is one. */
export function pythonIn(dir: string): string | null {
  const options = isWin
    ? [path.join(dir, "python.exe"), path.join(dir, "Scripts", "python.exe")]
    : [path.join(dir, "bin", "python3"), path.join(dir, "bin", "python")];
  return options.find(exists) ?? null;
}

async function candidates(): Promise<string[]> {
  const found = new Set<string>();
  const add = (p: string | null | undefined) => p && exists(p) && found.add(path.normalize(p));
  const addEnvDir = (dir: string) => add(pythonIn(dir));

  // Interpreters on PATH (skipping the Windows Store "python" stub).
  for (const dir of (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter)) {
    if (!dir || /WindowsApps/i.test(dir)) continue;
    for (const name of isWin ? ["python.exe"] : ["python3", "python"]) add(path.join(dir, name));
  }

  // Everything the Windows "py" launcher knows about.
  if (isWin) {
    const res = await run("py", ["-0p"], { timeout: 5_000 });
    for (const m of res.stdout.matchAll(/([A-Za-z]:\\[^\r\n]*?python\.exe)/gi)) add(m[1].trim());
  } else {
    ["/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"].forEach(add);
  }

  // Conda: the environments conda itself has recorded, plus common install roots.
  try {
    const txt = fs.readFileSync(path.join(home, ".conda", "environments.txt"), "utf8");
    txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach(addEnvDir);
  } catch {
    /* no conda history */
  }
  const condaRoots = [
    process.env.CONDA_EXE && path.dirname(path.dirname(process.env.CONDA_EXE)),
    process.env.CONDA_PREFIX,
    ...["miniconda3", "anaconda3", "miniforge3", "mambaforge", "micromamba", "Miniconda3", "Anaconda3"].flatMap((n) => [
      path.join(home, n),
      ...(isWin
        ? [path.join(process.env.LOCALAPPDATA ?? "", n), path.join("C:\\ProgramData", n)]
        : [path.join("/opt", n)]),
    ]),
    isWin ? undefined : "/opt/conda",
  ].filter((p): p is string => !!p);
  for (const root of condaRoots) {
    addEnvDir(root);
    subdirs(path.join(root, "envs")).forEach(addEnvDir);
  }

  // Virtual environments in the usual places, and pyenv versions.
  if (process.env.VIRTUAL_ENV) addEnvDir(process.env.VIRTUAL_ENV);
  for (const dir of [
    path.join(home, ".virtualenvs"),
    path.join(home, ".venvs"),
    path.join(home, "venvs"),
    path.join(home, "Envs"),
    path.join(home, ".local", "share", "virtualenvs"),
    path.join(home, ".cache", "pypoetry", "virtualenvs"),
    ...(isWin ? [path.join(process.env.LOCALAPPDATA ?? "", "pypoetry", "Cache", "virtualenvs")] : []),
    path.join(home, ".pyenv", "versions"),
    path.join(home, ".pyenv", "pyenv-win", "versions"),
  ]) {
    subdirs(dir).forEach(addEnvDir);
  }
  [".venv", "venv"].forEach((n) => addEnvDir(path.join(home, n)));

  getSetting<string[]>(CUSTOM_KEY, []).forEach(add);
  return [...found];
}

function describe(p: Probe, custom: boolean): PythonEnv {
  const prefix = path.normalize(p.prefix);
  const base = path.basename(prefix);
  let kind: EnvKind = "system";
  let name = `Python ${p.version}`;
  if (p.conda) {
    kind = "conda";
    const isRoot = fs.existsSync(path.join(prefix, "condabin")) || fs.existsSync(path.join(prefix, "envs"));
    name = isRoot ? "base" : base;
  } else if (path.normalize(p.base_prefix) !== prefix) {
    kind = "venv";
    name = [".venv", "venv", "env"].includes(base) ? `${path.basename(path.dirname(prefix))}/${base}` : base;
  } else if (/[\\/]\.pyenv[\\/]/.test(prefix)) {
    kind = "pyenv";
    name = `pyenv ${base}`;
  }
  const python = path.normalize(p.executable);
  return { id: python, python, name, kind, version: p.version, prefix, hasIpykernel: p.ipykernel, custom };
}

const ORDER: Record<EnvKind, number> = { conda: 0, venv: 1, pyenv: 2, system: 3 };
const keyOf = (p: string) => (isWin ? p.toLowerCase() : p);

let cache: { at: number; envs: PythonEnv[] } | null = null;
let scanning: Promise<PythonEnv[]> | null = null;

export async function listEnvs(refresh = false): Promise<PythonEnv[]> {
  if (!refresh && cache && Date.now() - cache.at < 5 * 60_000) return cache.envs;
  if (scanning) return scanning;
  scanning = (async () => {
    const customs = new Set(getSetting<string[]>(CUSTOM_KEY, []).map(keyOf));
    const paths = await candidates();
    const probes = await Promise.all(paths.map(async (p) => ({ p, info: await probe(p) })));
    const byExe = new Map<string, PythonEnv>();
    for (const { p, info } of probes) {
      if (!info) continue;
      const env = describe(info, customs.has(keyOf(path.normalize(p))));
      const k = keyOf(env.python);
      if (!byExe.has(k)) byExe.set(k, env);
    }
    const envs = [...byExe.values()].sort(
      (a, b) => ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name) || b.version.localeCompare(a.version),
    );
    cache = { at: Date.now(), envs };
    return envs;
  })();
  try {
    return await scanning;
  } finally {
    scanning = null;
  }
}

export async function findEnv(python: string): Promise<PythonEnv | undefined> {
  const k = keyOf(path.normalize(python));
  return (await listEnvs()).find((e) => keyOf(e.python) === k);
}

/** Adds an interpreter by path (to python itself or to an environment folder). */
export async function addCustomEnv(input: string): Promise<PythonEnv> {
  const raw = input.trim().replace(/^["']|["']$/g, "");
  let python = raw;
  try {
    if (fs.statSync(raw).isDirectory()) python = pythonIn(raw) ?? "";
  } catch {
    throw new Error("That path does not exist.");
  }
  if (!python) throw new Error("No Python interpreter found in that folder.");
  const info = await probe(python);
  if (!info) throw new Error("That file did not run as a Python interpreter.");
  const env = describe(info, true);
  const list = getSetting<string[]>(CUSTOM_KEY, []);
  if (!list.some((p) => keyOf(p) === keyOf(env.python))) setSetting(CUSTOM_KEY, [...list, env.python]);
  cache = null;
  return env;
}

/** pip-installs ipykernel into an environment (only ever on the user's request). */
export async function installIpykernel(python: string): Promise<{ ok: boolean; log: string }> {
  const env = await findEnv(python);
  if (!env) return { ok: false, log: "Unknown environment." };
  const res = await run(env.python, ["-m", "pip", "install", "ipykernel"], {
    timeout: 10 * 60_000,
    env: activationEnv(env),
  });
  cache = null;
  const log = (res.stdout + "\n" + res.stderr).trim().split(/\r?\n/).slice(-25).join("\n");
  return { ok: res.code === 0, log };
}

/** Roughly what `conda activate` / `source venv/bin/activate` set up. */
export function activationEnv(env: PythonEnv): NodeJS.ProcessEnv {
  const vars: NodeJS.ProcessEnv = { ...process.env };
  const pathKey = Object.keys(vars).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const p = env.prefix;
  const dirs = isWin
    ? [p, path.join(p, "Library", "mingw-w64", "bin"), path.join(p, "Library", "usr", "bin"), path.join(p, "Library", "bin"), path.join(p, "Scripts"), path.join(p, "bin")]
    : [path.join(p, "bin")];
  vars[pathKey] = [...dirs, vars[pathKey] ?? ""].join(path.delimiter);
  if (env.kind === "conda") {
    vars.CONDA_PREFIX = p;
    vars.CONDA_DEFAULT_ENV = env.name;
  } else if (env.kind === "venv") {
    vars.VIRTUAL_ENV = p;
  }
  delete vars.PYTHONHOME;
  vars.PYTHONUNBUFFERED = "1";
  return vars;
}
