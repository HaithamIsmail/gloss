#!/usr/bin/env node
// Starts Gloss: installs dependencies and builds the app when needed, runs the
// server, and opens it in the browser.
//
//   node scripts/start.mjs            production server on PORT (default 3001)
//   node scripts/start.mjs --dev      development servers with live reload (port 5173)
//   node scripts/start.mjs --no-open  don't open the browser
//   node scripts/start.mjs --port 8080
//
// Also available as `npm run app`, start.bat (Windows) and start.sh (macOS/Linux).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag("--help") || flag("-h")) {
  console.log(`Usage: node scripts/start.mjs [--dev] [--no-open] [--port <number>]

  --dev        run the development servers (live reload) instead of the built app
  --no-open    don't open the browser
  --port <n>   port for the app (production only; default: PORT or 3001)`);
  process.exit(0);
}

const dev = flag("--dev");
const open = !flag("--no-open");
const port = Number(option("--port") ?? process.env.PORT ?? 3001);
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const say = (msg) => console.log(`\x1b[31m■\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\n\x1b[31mGloss can't start:\x1b[0m ${msg}\n`);
  process.exit(1);
};

// ── Node.js version ─────────────────────────────────────────────────────
// The database uses Node's built-in SQLite (node:sqlite), new in 22.13.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  fail(`Node.js 22.13 or newer is needed (you have ${process.versions.node}). Get it from https://nodejs.org`);
}

const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

/** Newest modification time of the files under these paths. */
function newest(paths) {
  let latest = 0;
  const walk = (p) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    else latest = Math.max(latest, st.mtimeMs);
  };
  paths.forEach(walk);
  return latest;
}

function run(cmd, cmdArgs, what) {
  say(what);
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: isWindows });
  if (r.status !== 0) fail(`"${cmd} ${cmdArgs.join(" ")}" failed. See the messages above.`);
}

// ── Dependencies ────────────────────────────────────────────────────────
// npm writes node_modules/.package-lock.json on every install.
if (mtime("node_modules/.package-lock.json") < mtime("package-lock.json")) {
  run(npm, ["install"], "Installing dependencies (first run or after an update)…");
}

// ── Already running? ────────────────────────────────────────────────────
/** True when the app (its page, not just the API) answers at this address. */
async function isGloss(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.text()).includes("<title>Gloss</title>");
  } catch {
    return false;
  }
}

/** True when nothing is listening on the port. */
function portFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(p, "127.0.0.1");
  });
}

function openBrowser(url) {
  if (!open) return;
  const [cmd, cmdArgs] = isWindows
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
}

const devUrl = "http://localhost:5173";
const appUrl = dev ? devUrl : `http://localhost:${port}`;
// A plain start also finds the development servers if they are running; an explicit port means that port.
const portGiven = option("--port") !== undefined || process.env.PORT !== undefined;
for (const url of dev || portGiven ? [appUrl] : [appUrl, devUrl]) {
  if (await isGloss(url)) {
    say(`Gloss is already running at ${url}`);
    openBrowser(url);
    process.exit(0);
  }
}
for (const p of dev ? [5173, Number(process.env.API_PORT ?? 3001)] : [port]) {
  if (!(await portFree(p))) {
    fail(
      `port ${p} is used by another program.` +
        (dev ? " Stop it, or set API_PORT to another port." : ` Stop it, or choose another port: --port ${p + 1}`),
    );
  }
}

// ── Build (production only) ─────────────────────────────────────────────
if (!dev) {
  const sources = newest(["src", "shared", "public", "index.html", "vite.config.ts", "package-lock.json"]);
  if (mtime("dist/index.html") < sources) {
    run(npm, ["run", "build"], "Building the app (only when its code changed)…");
  }
}

// ── Start ───────────────────────────────────────────────────────────────
say(dev ? "Starting the development servers…" : `Starting Gloss on port ${port}…`);
const child = spawn(npm, [dev ? "run" : "start", ...(dev ? ["dev"] : [])], {
  stdio: "inherit",
  shell: isWindows,
  env: { ...process.env, ...(dev ? {} : { PORT: String(port) }) },
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill("SIGINT");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));

// Open the browser once the app answers.
const started = Date.now();
while (!stopping && Date.now() - started < 90_000) {
  if (await isGloss(appUrl)) {
    say(`Gloss is ready at ${appUrl}  (press Ctrl+C to stop)`);
    openBrowser(appUrl);
    break;
  }
  await new Promise((r) => setTimeout(r, 400));
}
