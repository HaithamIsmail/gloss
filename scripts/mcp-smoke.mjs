// Exercises Gloss's MCP endpoint end to end with the SDK's client.
// Run it against a throw-away workspace, never your real data:
//   DATA_DIR=/tmp/gloss-test API_PORT=3002 npm run dev:api
//   node scripts/mcp-smoke.mjs http://localhost:3002/mcp
// Exits non-zero on the first mismatch.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/mcp-smoke.mjs <MCP URL>, e.g. http://localhost:3002/mcp");
  process.exit(2);
}

const client = new Client({ name: "gloss-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

let step = "";
function fail(msg) {
  console.error(`✗ ${step}: ${msg}`);
  process.exit(1);
}
function ok(cond, msg) {
  if (!cond) fail(msg);
}
async function call(name, args = {}, { expectError = false } = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  if (!!res.isError !== expectError) fail(`${name} ${expectError ? "should have failed" : "failed"}: ${text}`);
  if (expectError) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const run = async (name, fn) => {
  step = name;
  await fn();
  console.log(`✓ ${name}`);
};
/** The page's Markdown without the id comments. */
const plain = (md) => md.replace(/^ *<!-- id: [\w-]+ -->\n/gm, "");
/** The first line where two texts differ, for messages. */
function firstDiff(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  const i = x.findIndex((l, n) => l !== y[n]);
  return `line ${i + 1}: ${JSON.stringify(x[i])} vs ${JSON.stringify(y[i])}`;
}
const ids = (md) => [...md.matchAll(/<!-- id: ([\w-]+) -->/g)].map((m) => m[1]);

let course, page, uploadUrl;

await run("list tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ["get_tree", "search", "get_material", "edit_page", "create_notebook", "upload_file", "restore_version"]) {
    ok(names.includes(n), `missing tool ${n}`);
  }
  ok(!names.some((n) => /purge|empty_trash|kernel|run_/.test(n)), "a tool that should not exist is listed");
  ok(tools.find((t) => t.name === "get_tree").annotations?.readOnlyHint === true, "get_tree is not marked read-only");
  ok(tools.find((t) => t.name === "delete_material").annotations?.destructiveHint === true, "delete_material is not marked destructive");
  console.log(`  ${names.length} tools: ${names.join(", ")}`);
});

await run("get_tree", async () => {
  const tree = await call("get_tree");
  ok(Array.isArray(tree.courses) && tree.courses.length > 0, "no courses (is this a seeded workspace?)");
  ok(Array.isArray(tree.library), "no library list");
  course = await call("create_course", { name: "MCP smoke test", code: "SMOKE 1" });
  ok(course.id && course.name === "MCP smoke test", "create_course returned no course");
  const one = await call("get_tree", { courseId: course.id });
  ok(one.courses.length === 1 && one.courses[0].materials.length === 0, "the new course isn't empty");
});

await run("upload_file", async () => {
  // A 1×1 PNG.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const up = await call("upload_file", { name: "dot.png", base64: png });
  ok(/^\/uploads\/[\w-]+\.png$/.test(up.url), `bad upload url ${up.url}`);
  uploadUrl = up.url;
  const res = await fetch(new URL(up.url, url));
  ok(res.ok, `the uploaded file isn't served (${res.status})`);
});

// Every construct the Markdown converter supports, written the way get_material writes it.
const tree0 = await call("get_tree");
const target = tree0.courses[0].materials[0];
const MD = () => `# Section one

A paragraph with **bold**, *italic*, ~~strike~~, \`code\`, <u>underline</u>, a [link](https://example.com) and $E = mc^2$.${"  "}
A second line with a mention [@${target.title}](/m/${target.id}) and a dollar \\$5.

## Subsection

- bullet one
- bullet two

  - nested bullet

- [ ] open task
- [x] done task
1. first
2. second

\`\`\`python
print("hi")
\`\`\`

---

$$
\\int_0^1 x\\,dx = \\tfrac{1}{2}
$$

> [!NOTE]
> A note.

> [!TIP]
> A tip with $x$.

> [!WARNING]
> A warning.

> [!IMPORTANT]
> On the exam.

> A plain quote.

| Term | Meaning |
| --- | --- |
| *a* | b \\| c |

![dot](${uploadUrl})

### Minor heading

<p></p>

Last paragraph.`;

await run("create_page from Markdown", async () => {
  page = await call("create_page", { courseId: course.id, title: "Every construct", markdown: MD() });
  ok(page.kind === "doc", "not a page");
  ok(JSON.stringify(page.outline) === JSON.stringify(["1 Section one", "1.1 Subsection"]), `outline ${JSON.stringify(page.outline)}`);
});

let blocks;
await run("get_material round trip", async () => {
  const m = await call("get_material", { id: page.id });
  ok(plain(m.markdown) === MD(), `Markdown changed on the way back, ${firstDiff(plain(m.markdown), MD())}`);
  const b = await call("get_material", { id: page.id, format: "blocks" });
  blocks = b.blocks;
  const types = new Set();
  const walk = (bs) => bs.forEach((x) => (types.add(x.type), walk(x.children ?? [])));
  walk(blocks);
  for (const t of ["heading", "paragraph", "bulletListItem", "checkListItem", "numberedListItem", "codeBlock", "divider", "mathBlock", "callout", "quote", "table", "image"]) {
    ok(types.has(t), `no ${t} block`);
  }
  const para = blocks[1].content;
  ok(para.some((c) => c.type === "math" && c.props.latex === "E = mc^2"), "inline math missing");
  ok(para.some((c) => c.type === "mention" && c.props.targetId === target.id), "mention missing");
  ok(para.some((c) => c.type === "link" && c.href === "https://example.com"), "link missing");
  ok(para.some((c) => c.styles?.underline), "underline missing");
  const tones = blocks.filter((x) => x.type === "callout").map((x) => x.props.tone);
  ok(JSON.stringify(tones) === JSON.stringify(["note", "tip", "warning", "exam"]), `callout tones ${tones}`);
  ok(ids(m.markdown).length > blocks.length, "nested blocks have no id comments");
  const mt = await call("get_material", { id: target.id });
  ok(mt.id === target.id, "seeded material can't be read");
});

await run("edit_page operations", async () => {
  const m = await call("get_material", { id: page.id });
  const all = ids(m.markdown);
  const [h1, para] = all;
  const last = all[all.length - 1];
  const nested = blocks.find((b) => b.children?.length).children[0].id;
  const before = JSON.stringify(blocks.find((b) => b.type === "table"));
  const r = await call("edit_page", {
    id: page.id,
    operations: [
      { op: "replace_block", id: para, markdown: "Replaced paragraph." },
      { op: "insert_after", id: h1, markdown: "Inserted after the heading." },
      { op: "insert_before", id: h1, markdown: "Inserted before the heading." },
      { op: "delete_block", id: last },
      { op: "replace_block", id: nested, markdown: "- nested, edited" },
    ],
  });
  ok(r.results.length === 5 && r.results[1].ids.length === 1, "no ids reported for inserts");
  const after = await call("get_material", { id: page.id, format: "blocks" });
  const b = after.blocks;
  ok(b[0].content[0].text === "Inserted before the heading.", "insert_before");
  ok(b[1].id === h1 && b[2].content[0].text === "Inserted after the heading.", "insert_after");
  ok(b[3].content[0].text === "Replaced paragraph.", "replace_block");
  ok(!JSON.stringify(b).includes("Last paragraph."), "delete_block");
  ok(JSON.stringify(b).includes("nested, edited"), "nested replace_block");
  ok(JSON.stringify(b.find((x) => x.type === "table")) === before, "an untouched block changed");

  const bad = await call("edit_page", { id: page.id, operations: [{ op: "replace_block", id: h1, markdown: "x" }, { op: "delete_block", id: "nope" }] }, { expectError: true });
  ok(/nope/.test(bad), `the error doesn't name the missing id: ${bad}`);
  const same = await call("get_material", { id: page.id, format: "blocks" });
  ok(JSON.stringify(same.blocks) === JSON.stringify(b), "a failed edit_page changed the page");

  await call("append_to_page", { id: page.id, markdown: "Appended." });
  const md = (await call("get_material", { id: page.id })).markdown;
  ok(md.trimEnd().endsWith("Appended."), "append_to_page");

  const kept = (await call("get_material", { id: page.id, format: "blocks" })).blocks;
  await call("edit_page", { id: page.id, operations: [{ op: "replace_all", markdown: md }] });
  const re = (await call("get_material", { id: page.id, format: "blocks" })).blocks;
  ok(JSON.stringify(re) === JSON.stringify(kept), "replace_all with the page's own Markdown didn't keep every block");
});

await run("annotated image survives edits", async () => {
  const heart = (await call("search", { query: "Unit 3" })).find((r) => r.materialId)?.materialId;
  ok(heart, "the seeded heart page isn't there");
  const before = (await call("get_material", { id: heart, format: "blocks" })).blocks;
  const img = before.find((b) => b.type === "annotatedImage");
  ok(img, "no annotated image on the seeded page");
  const md = (await call("get_material", { id: heart })).markdown;
  const firstPara = ids(md)[1];
  await call("edit_page", { id: heart, operations: [{ op: "replace_block", id: firstPara, markdown: "Edited by the smoke test." }] });
  const mid = (await call("get_material", { id: heart, format: "blocks" })).blocks;
  ok(JSON.stringify(mid.find((b) => b.type === "annotatedImage")) === JSON.stringify(img), "the annotated image changed");
  await call("edit_page", { id: heart, operations: [{ op: "replace_all", markdown: plain((await call("get_material", { id: heart })).markdown) }] });
  const after = (await call("get_material", { id: heart, format: "blocks" })).blocks;
  ok(JSON.stringify(after.find((b) => b.type === "annotatedImage")) === JSON.stringify(img), "replace_all lost the image's regions");
  const passages = JSON.stringify(after).match(/"annotation":/g)?.length ?? 0;
  ok(passages === (JSON.stringify(before).match(/"annotation":/g)?.length ?? 0), "linked passages were lost");
});

await run("notebook create/edit", async () => {
  const nb = await call("create_notebook", {
    courseId: course.id,
    title: "Smoke notebook",
    cells: [
      { type: "markdown", source: "# Title" },
      { type: "code", source: "1 + 1" },
    ],
  });
  ok(nb.cells.length === 2 && nb.outline[0] === "1 Title", "create_notebook");
  const [md, code] = nb.cells;
  const r = await call("edit_notebook", {
    id: nb.id,
    operations: [
      { op: "add_cell", after: md, type: "code", source: "x = 2" },
      { op: "add_cell", type: "markdown", source: "End" },
      { op: "add_cell", after: "start", type: "markdown", source: "Start" },
      { op: "replace_cell", id: code, source: "2 + 2" },
      { op: "delete_cell", id: md },
    ],
  });
  const got = await call("get_material", { id: nb.id });
  ok(JSON.stringify(got.cells.map((c) => c.source)) === JSON.stringify(["Start", "x = 2", "2 + 2", "End"]), `cells ${JSON.stringify(got.cells.map((c) => c.source))}`);
  ok(r.added.length === 3, "added ids");
  await call("edit_notebook", { id: nb.id, operations: [{ op: "delete_cell", id: "missing" }] }, { expectError: true });
});

await run("artifact create/write/read", async () => {
  const a = await call("create_artifact", {
    courseId: course.id,
    title: "Smoke artifact",
    description: "A test page.",
    html: "<!doctype html><title>Smoke</title><link rel=stylesheet href=style.css><p>Hello</p>",
    files: [{ path: "style.css", text: "p { color: red }" }],
  });
  ok(a.files.length === 2, "create_artifact files");
  await call("write_artifact_file", { id: a.id, path: "app.js", text: "console.log(1)" });
  const f = await call("read_artifact_file", { id: a.id, path: "app.js" });
  ok(f.text === "console.log(1)", "read_artifact_file");
  const d = await call("delete_artifact_file", { id: a.id, path: "app.js" });
  ok(!d.files.some((x) => x.path === "app.js"), "delete_artifact_file");
  await call("delete_artifact_file", { id: a.id, path: "index.html" }, { expectError: true });
  const desc = await call("get_material", { id: a.id });
  ok(desc.description === "A test page.", "artifact description");
});

await run("move and rename", async () => {
  const folder = await call("create_folder", { courseId: course.id, title: "Smoke folder" });
  const moved = await call("move_material", { id: page.id, parentId: folder.id });
  ok(moved.parentId === folder.id, "into the folder");
  const second = await call("create_page", { courseId: course.id, title: "Second", markdown: "Hi", parentId: folder.id });
  await call("move_material", { id: second.id, before: page.id });
  const kids = (await call("get_material", { id: folder.id })).children.map((c) => c.id);
  ok(JSON.stringify(kids) === JSON.stringify([second.id, page.id]), `order ${kids}`);
  const out = await call("move_material", { id: second.id, parentId: null });
  ok(out.parentId === null, "out of the folder");
  const r = await call("rename_material", { id: second.id, title: "Renamed" });
  ok(r.title === "Renamed", "rename");
  await call("update_course", { id: course.id, code: "SMOKE 2" });
});

await run("delete → list_trash → restore", async () => {
  const { trashId } = await call("delete_material", { id: page.id });
  ok(trashId, "no trash id");
  await call("get_material", { id: page.id }, { expectError: true });
  const trash = await call("list_trash");
  ok(trash.some((t) => t.id === trashId), "not in the trash");
  const r = await call("restore_from_trash", { trashId });
  ok(r.itemId === page.id, "restore");
  const back = await call("get_material", { id: page.id });
  ok(back.id === page.id, "not back");
});

await run("restore_version", async () => {
  const versions = await call("list_versions", { id: page.id });
  // edit_page and append_to_page changed it; the identical replace_all didn't.
  ok(versions.length === 2, `every edit should store a version (got ${versions.length})`);
  const oldest = versions[versions.length - 1];
  const r = await call("restore_version", { id: page.id, versionId: oldest.id });
  ok(r.id === page.id, "restore_version");
  const md = plain((await call("get_material", { id: page.id })).markdown);
  ok(md === MD(), `the first version isn't the page as created (${firstDiff(md, MD())})`);
});

await run("errors", async () => {
  const e = await call("get_material", { id: "no-such-id" }, { expectError: true });
  ok(/No material with id "no-such-id"/.test(e), `message: ${e}`);
  const e2 = await call("edit_page", { id: course.id, operations: [{ op: "delete_block", id: "x" }] }, { expectError: true });
  ok(/No material/.test(e2), `message: ${e2}`);
  const nbId = (await call("get_tree", { courseId: course.id })).courses[0].materials.find((m) => m.kind === "notebook").id;
  const e3 = await call("append_to_page", { id: nbId, markdown: "x" }, { expectError: true });
  ok(/is a notebook, not a page/.test(e3), `message: ${e3}`);
});

await run("clean up", async () => {
  const { trashId } = await call("delete_course", { id: course.id });
  ok(trashId, "delete_course");
});

await client.close();
console.log("All MCP checks passed.");
