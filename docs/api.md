# HTTP API

The web app talks to the server through this JSON API. It is meant for the app itself, but you can script it from your
own computer (requests must come from `localhost`; see [Security model](configuration.md#security-model)).

Errors come back as `{ "error": "message" }` with a 4xx/5xx status (a plain `404 Not Found` for unknown ids).

- [Courses and the tree](#courses-and-the-tree)
- [Materials](#materials)
- [Versions and links](#versions-and-links)
- [Drawings](#drawings)
- [Trash](#trash)
- [Backups and export](#backups-and-export)
- [Search](#search)
- [Uploads and slide import](#uploads-and-slide-import)
- [Python environments and kernels](#python-environments-and-kernels)
- [Static files](#static-files)

---

## Courses and the tree

| Method & path | Body | Response |
| --- | --- | --- |
| `GET /api/tree` | — | `{ courses: [{ id, name, code, position, materials: MaterialSummary[] }] }` (not trashed, by position) |
| `POST /api/courses` | `{ name?, code? }` | `201` Course |
| `PATCH /api/courses/:id` | `{ name?, code?, position? }` | Course · `404` |
| `DELETE /api/courses/:id` | — | `{ trashId }` (course and its materials to the trash) · `404` |

`MaterialSummary` = `{ id, courseId, parentId, kind, title, position, outline: [{id, level, text, num}], regions, updatedAt }`.

## Materials

| Method & path | Body | Response |
| --- | --- | --- |
| `POST /api/courses/:id/materials` | `{ title?, kind?: "doc"\|"image"\|"notebook"\|"folder", content?, parentId? }` | `201` Material · `404` · `400` (*That folder doesn't exist.*, *That folder is in another course.*, *Folders can't go inside other folders.*) |
| `GET /api/materials/:id` | — | Material (`MaterialSummary` + `content`) · `404` |
| `PATCH /api/materials/:id` | `{ title?, content?, position?, courseId?, parentId? }` | MaterialSummary · `400` · `404` |
| `DELETE /api/materials/:id` | — | `{ trashId }` (a folder takes its pages) · `404` |
| `POST /api/materials/:id/append` | `{ blocks: Block[] }` | MaterialSummary (adds blocks to the end of a page) · `400` · `404` |
| `GET /api/materials/:id/image` | — | `302` to an image page's picture · `404` |

`PATCH` with `courseId` and/or `parentId` moves the material (`parentId: null` = top level); a folder moved to another
course takes its pages. Changing `content` may store the previous content as a version.

## Versions and links

| Method & path | Response |
| --- | --- |
| `GET /api/materials/:id/versions` | `[{ id, title, createdAt, size }]`, newest first |
| `GET /api/versions/:id` | `{ id, materialId, title, createdAt, size, kind, content }` |
| `POST /api/materials/:id/versions/:versionId/restore` | Material (the current content is kept as a version first) |
| `GET /api/materials/:id/backlinks` | `[{ materialId, title, kind, courseName, count }]` |
| `GET /api/link-targets?q=` | `[{ kind: "material"\|"region", materialId, materialKind, annotationId?, blockId?, n?, title, path }]` — up to 12 materials and (when `q` is given) 12 commented regions |

## Drawings

| Method & path | Body | Response |
| --- | --- | --- |
| `GET /api/drawings` | — | DrawingSummary[] (`{ id, title, courseId, hasPreview, createdAt, updatedAt }`), newest first |
| `POST /api/drawings` | `{ title?, courseId?, scene?, preview? }` | `201` DrawingSummary |
| `GET /api/drawings/:id` | — | Drawing (summary + `scene`) · `404` |
| `PATCH /api/drawings/:id` | same as POST (`preview: null` clears it) | DrawingSummary · `404` |
| `DELETE /api/drawings/:id` | — | `{ trashId }` · `404` |
| `GET /api/drawings/:id/preview.svg` | — | SVG with `ETag` (`304` when unchanged) · `404` |

## Trash

| Method & path | Response |
| --- | --- |
| `GET /api/trash` | `[{ id, kind: "course"\|"material"\|"drawing", itemId, materialKind?, title, where, contains, deletedAt }]` |
| `POST /api/trash/:id/restore` | `{ kind, itemId }` · `404` · `409` (*This was in "…", which is in the trash too. Restore the course first.*) |
| `DELETE /api/trash/:id` | `204` (deleted for good) · `404` |
| `DELETE /api/trash` | `204` (empty the trash) |

## Backups and export

| Method & path | Response |
| --- | --- |
| `GET /api/backups` | `[{ name, size, createdAt }]`, newest first |
| `POST /api/backups` | `201` BackupInfo (makes a backup now) |
| `GET /api/backups/:name` | the `.db` file · `404` |
| `GET /api/export/course/:id` | zip of the course as Markdown |
| `GET /api/export/material/:id` | zip of one material as Markdown |
| `GET /api/export/all` | zip of the whole data folder (fresh database snapshot + files) |

## Search

| Method & path | Response |
| --- | --- |
| `GET /api/search?q=` | up to 40 `{ kind, label, title, path, courseId?, materialId?, blockId?, annotationId?, drawingId? }` |

## Uploads and slide import

| Method & path | Body | Response |
| --- | --- | --- |
| `POST /api/uploads` | multipart `file` (≤ 300 MB) | `201` `{ url: "/uploads/…", name }` |
| `GET /api/convert/available` | — | `{ slides: "powerpoint" \| "libreoffice" \| null }` |
| `POST /api/convert/slides` | multipart `file` (.pptx .ppt .pptm .ppsx .pps .odp) | `{ url, name, pdfUrl, converter }` · `400` · `501` (no converter) · `500` |
| `POST /api/courses/:id/slides` | `{ title, source: { name, url, pdfUrl, type }, pages: [{ title, url, name, text? }] }` | `201` folder Material |

## Python environments and kernels

| Method & path | Body | Response |
| --- | --- | --- |
| `GET /api/envs[?refresh=1]` | — | `[{ id, python, name, kind, version, prefix, hasIpykernel, custom }]` (cached 5 min) |
| `POST /api/envs` | `{ path }` (folder or interpreter) | `201` environment · `400` |
| `POST /api/envs/install-ipykernel` | `{ python }` | `{ ok, log }` |
| `WS /api/kernels/ws?material=&python=` | — | Kernel bridge for a notebook |

WebSocket messages — client → server: `{ type: "execute", id, code }`, `{ type: "interrupt" }`, `{ type: "restart" }`,
`{ type: "input_reply", value }`. Server → client: `info`, `status`, `output`, `clear`, `input_request`, `done`.

## Static files

| Path | Serves |
| --- | --- |
| `/uploads/*` | `data/uploads` |
| `/excalidraw-assets/fonts/*` | Excalidraw's fonts |
| `/pyodide/*` | the Pyodide runtime |
| `/pdfjs/{cmaps,standard_fonts,wasm,iccs}/*` | pdf.js data |
