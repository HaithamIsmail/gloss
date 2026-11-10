# Agents (MCP)

AI agents such as Claude Code and Claude Desktop can work in Gloss for you: read your courses, write pages and
notebooks, build artifacts, tidy up the tree. They connect to the running app over the
[Model Context Protocol](https://modelcontextprotocol.io) (MCP). Everything an agent changes shows up in open tabs at
once, every edit is kept in History, and whatever it deletes goes to the Trash.

- [Connecting an agent](#connecting-an-agent)
- [What agents can do](#what-agents-can-do)
- [Pages as Markdown](#pages-as-markdown)
- [Editing a page](#editing-a-page)
- [Open tabs follow along](#open-tabs-follow-along)
- [Undoing an agent's work](#undoing-an-agents-work)
- [What agents can't do](#what-agents-cant-do)
- [Turning it off](#turning-it-off)

---

## Connecting an agent

Gloss must be running. The endpoint is `/mcp` on the address you open Gloss at:

| You started Gloss with | Endpoint |
| --- | --- |
| `start.bat`, `start.sh`, `npm run app`, `npm start` | `http://localhost:3001/mcp` |
| `npm run dev` | `http://localhost:5173/mcp` (forwarded to the API) or `http://localhost:3001/mcp` |

**Settings → Agents (MCP)** shows the address for the window you have open, with snippets to copy.

**Claude Code:**

```bash
claude mcp add --transport http gloss http://localhost:3001/mcp
```

**Other agents** (Claude Desktop, Cursor, any client that speaks Streamable HTTP) take a JSON entry:

```json
{
  "mcpServers": {
    "gloss": { "type": "http", "url": "http://localhost:3001/mcp" }
  }
}
```

Only programs on this computer can connect, like the rest of the [API](api.md) (see
[Security model](configuration.md#security-model)). There is no sign-in: an agent you connect can read and change
everything, the same as you.

## What agents can do

The server tells the agent how Gloss is organised (courses → materials, the kinds, the Markdown below). These are its
tools:

| Group | Tools | What they do |
| --- | --- | --- |
| Browse and find | `get_tree`, `search`, `get_material`, `get_backlinks`, `list_versions`, `list_books`, `list_trash` | The course tree with outlines, search over everything, one material in a readable form, links to it, its earlier versions, the library, the trash |
| Courses and structure | `create_course`, `update_course`, `create_folder`, `move_material`, `rename_material` | Courses and folders; moving a material to another course, into or out of a folder, or next to another one |
| Pages | `create_page`, `append_to_page`, `edit_page` | Write a page from Markdown, add to its end, or change single blocks |
| Notebooks | `create_notebook`, `edit_notebook` | Add, replace and remove cells (replacing a code cell clears its outputs) |
| Artifacts | `create_artifact`, `read_artifact_file`, `write_artifact_file`, `delete_artifact_file` | HTML pages and their files, as in [Artifacts](artifacts.md) |
| Books | `update_book` | Reading status, details (authors, year, tags…), the note on a highlight |
| Files | `upload_file` | Store an image (up to 15 MB) and get its `/uploads/…` address for a page |
| Safety net | `delete_material`, `delete_course`, `restore_from_trash`, `restore_version` | Delete to the trash, bring back, put an earlier version back |

What `get_material` returns depends on the kind:

| Kind | You get |
| --- | --- |
| Page | Markdown with each block's id (or the BlockNote JSON with `format: "blocks"`) |
| Notebook | Each cell's id, type and source, and a short summary of its outputs |
| Image page | The image's address, the slide's text, and the regions with their comments |
| Book | Details, status, where you are, and the highlights with their notes |
| Artifact | Description and file list (read files with `read_artifact_file`) |
| Folder | The materials in it |

## Pages as Markdown

Agents read and write pages as Markdown, which Gloss turns into the same blocks you'd make in the editor:

| Write | You get |
| --- | --- |
| `# Heading`, `## Heading` | A section and a subsection (numbered by the app: don't type the numbers) |
| `### Heading` | A minor heading (`####` and smaller become this too) |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `<u>underline</u>`, `[text](https://…)` | Styled text and links |
| `-`, `1.`, `- [ ]` / `- [x]`, indented for nesting | Bullet, numbered and check lists |
| ```` ```python ```` … ```` ``` ```` | A code block with its language |
| `$x^2$` | An inline formula |
| `$$` on its own line, LaTeX, `$$` | A formula block |
| `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!IMPORTANT]` then `> text` | A callout (*IMPORTANT* is the exam tone) |
| `> text` | A quote |
| A Markdown table | A table (the first row is the header) |
| `---` | A divider |
| `![name](/uploads/…)` | An image (upload it first with `upload_file`) |
| `[@Title](/m/MATERIAL_ID)` | An `@` link to a material; add `?ann=REGION_ID&block=IMAGE_BLOCK_ID` for one region of an image |

A few things only the app makes: regions on an image, drawings, colours. Agents see them and can keep them, as the
next section explains, but not draw them.

## Editing a page

`get_material` puts a comment before every block, nested ones included:

```markdown
<!-- id: kUgQqHIaDT -->
## Atria

<!-- id: JO5rOHhRfw -->
The <mark data-region="3yC8SXaz9B">right atrium</mark> receives deoxygenated blood…
```

`edit_page` takes a list of operations on those ids, applied in order and all or nothing (if one id is wrong, nothing
changes and the error names it):

| Operation | Effect |
| --- | --- |
| `replace_block { id, markdown }` | Replaces the block (with its nested blocks) by what the Markdown makes |
| `insert_after { id, markdown }`, `insert_before { id, markdown }` | Adds blocks next to that one |
| `delete_block { id }` | Removes the block and its nested blocks |
| `replace_all { markdown }` | Replaces the whole page |

Blocks the operations don't touch stay exactly as they were. When the Markdown brings back a block under its own
`<!-- id: … -->` comment and unchanged, that block keeps its id and everything about it. Annotated images and drawings
come back with their regions as long as their image line (`![name](address)`) stays, and `<mark data-region="…">`
keeps a passage linked to its region.

## Open tabs follow along

When an agent changes a page, notebook or image page you have open, the tab reloads it and shows *Updated by an
agent.* Changes to the tree (new pages, titles, moves, the trash) appear in the sidebar at once.

If you were typing in that page at the same moment, your unsaved keystrokes since the last save are dropped in favour
of the agent's version (*Your last edit wasn't saved*), rather than silently overwriting the agent's work. Artifacts
reload on their own as before, and books merge every change on the server.

## Undoing an agent's work

- **History.** Before each change an agent makes to a material's content, Gloss keeps the previous content as a
  version, however recent the last one is. Choose **⋯ → Version history** in the top bar to look back and restore
  ([version history](trash-and-history.md#version-history)). Agents can do the same with `list_versions` and
  `restore_version`.
- **Trash.** `delete_material` and `delete_course` move things to the [Trash](trash-and-history.md) for 30 days.
  Agents can't empty the trash or delete anything for good.

## What agents can't do

- run notebook code, or use your Python environments and kernels (they write cells; you run them);
- draw on the Canvas or edit drawings, draw regions on images, or import slide decks;
- add book files to the library;
- change themes, settings or backups;
- delete anything for good.

## Turning it off

Start Gloss with `MCP=off` and `/mcp` is gone (it answers 404):

```bash
MCP=off npm start
```

On Windows PowerShell: `$env:MCP="off"; npm start`. See [Configuration](configuration.md#environment-variables).

For developers: the endpoint is stateless Streamable HTTP (`POST /mcp`, JSON responses). `scripts/mcp-smoke.mjs`
exercises every tool against a throw-away workspace:

```bash
DATA_DIR=/tmp/gloss-test API_PORT=3002 npm run dev:api
node scripts/mcp-smoke.mjs http://localhost:3002/mcp
```
