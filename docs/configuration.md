# Configuration

Gloss needs no configuration to run on your own computer. These settings are for changing ports, the data folder, or
reaching it from another device.

- [Environment variables](#environment-variables)
- [npm scripts](#npm-scripts)
- [Development vs production](#development-vs-production)
- [Security model](#security-model)
- [Opening Gloss to other devices](#opening-gloss-to-other-devices)
- [Limits](#limits)

---

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `DATA_DIR` | `data` | Folder for the database, uploads, backups and notebook folders. Relative paths are resolved from the folder you start Gloss in. |
| `SEED` | *(on)* | `SEED=0` starts a new installation empty instead of with the sample courses. Only matters on the very first launch. |
| `API_PORT` | `3001` | Port of the API server in development (`npm run dev`); the Vite dev server forwards to it. |
| `PORT` | `3001` | Port of the server in production (`npm start`). |
| `HOST` | `127.0.0.1` | Address the server listens on. See [Opening Gloss to other devices](#opening-gloss-to-other-devices). |
| `ALLOWED_HOSTS` | *(empty)* | Extra host names (comma-separated) accepted in requests besides `localhost`, `127.0.0.1` and `::1`. |
| `NODE_ENV` | — | `production` makes the server serve the built app from `dist/` (set by `npm start`). |

Examples:

```bash
# keep notes in another folder (Windows PowerShell: $env:DATA_DIR="D:\notes"; npm run dev)
DATA_DIR=~/Documents/gloss-data npm run dev

# empty workspace on first launch
SEED=0 npm run dev

# production on port 8080
PORT=8080 npm start
```

The Vite dev server always uses port **5173**.

Gloss also reads, without you setting them: `PATH`, `CONDA_EXE`, `CONDA_PREFIX`, `VIRTUAL_ENV` and `LOCALAPPDATA` to
find Python environments, and `ProgramFiles` to find LibreOffice.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run app` | The launcher (`scripts/start.mjs`, also `start.bat` / `start.sh`): install and build when needed, start, open the browser. Options: `--port`, `--no-open`, `--dev` |
| `npm run dev` | API server (auto-restarts on server changes) + Vite dev server with hot reload, together |
| `npm run dev:api` | Only the API server |
| `npm run dev:web` | Only the Vite dev server |
| `npm run build` | Build the web app into `dist/` |
| `npm start` | Production: serve `dist/` and the API on one port |
| `npm run typecheck` | Type-check the client and the server |

## Development vs production

**Development** (`npm run dev`): open http://localhost:5173. Vite forwards `/api` (including the notebook kernel
WebSocket), `/uploads`, `/themes`, `/excalidraw-assets`, `/pyodide` and `/pdfjs` to the API server on `API_PORT`.

**Production** (`npm run build`, then `npm start`): open http://localhost:3001 (or `PORT`). One server serves the app,
the API, uploads, Excalidraw's fonts, the Pyodide runtime and pdf.js files. The server runs TypeScript directly with
`tsx`; there is no separate server build. Start it from the project folder.

## Security model

Notebooks can run code on your computer, so the server is locked to your machine by default:

- it listens on `127.0.0.1` only;
- every request must carry a `Host` of `localhost`, `127.0.0.1` or `::1` (or one in `ALLOWED_HOSTS`), and if it carries
  an `Origin` (as browsers do for cross-site requests), that must be local too — so other websites open in your
  browser can't call it (*403 Requests are only accepted from this computer.*);
- the notebook kernel WebSocket additionally **requires** a local `Origin`, an existing notebook and a Python
  environment Gloss discovered.

There are no user accounts: whoever can open the app can read and change everything.

## Opening Gloss to other devices

Only do this on a network you trust — anyone who can reach it can run Python on your computer through a notebook.

```bash
HOST=0.0.0.0 ALLOWED_HOSTS=my-laptop.local,192.168.1.20 npm start
```

`HOST` makes the server listen on the network; `ALLOWED_HOSTS` lists the names or addresses you will type in the other
device's browser.

## Limits

| Limit | Value |
| --- | --- |
| Uploaded file (image, PDF, slide deck) | 300 MB |
| One save of a page, notebook or drawing | 60 MB of JSON (drawings with pasted images, notebooks with huge outputs) |
| Notebook kernel message | 64 MB |
| Automatic backups kept | 20 |
| Versions kept per material | 100 |
| Days in the Trash | 30 |
| Local kernel kept alive after leaving its notebook | 15 minutes |
| Slide deck conversion | 5 minutes |
| Local kernel start | 90 seconds |
