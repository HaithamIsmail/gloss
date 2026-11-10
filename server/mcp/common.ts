// Helpers shared by the MCP tool groups: registration with error handling,
// lookups that fail with a clear sentence, and change events for open tabs.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Material, MaterialSummary } from "../../shared/api";
import type { LooseBlock } from "../../shared/content";
import type { MaterialKind } from "../../shared/pages";
import { emit } from "../events";
import { markdownToBlocks, type ParseOptions } from "../markdown";
import * as repo from "../repo";
import { UserError } from "../repo";

type ToolConfig<S extends z.ZodRawShape> = {
  title: string;
  description: string;
  input: S;
  /** Only reads. */
  readOnly?: boolean;
  /** Removes something (to the trash). */
  destructive?: boolean;
};

/**
 * Registers a tool whose handler returns a value (sent as JSON text) or throws.
 * A `UserError` becomes a tool error with its sentence; anything else too, with its message.
 */
export function tool<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  cfg: ToolConfig<S>,
  fn: (args: z.infer<z.ZodObject<S>>) => unknown,
) {
  server.registerTool(
    name,
    {
      title: cfg.title,
      description: cfg.description,
      inputSchema: cfg.input,
      annotations: {
        title: cfg.title,
        readOnlyHint: !!cfg.readOnly,
        destructiveHint: !!cfg.destructive,
        openWorldHint: false,
      },
    } as never,
    (async (args: z.infer<z.ZodObject<S>>): Promise<CallToolResult> => {
      try {
        const out = await fn(args);
        return { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 1) }] };
      } catch (err) {
        if (!(err instanceof UserError)) console.error(`MCP ${name}:`, err);
        return { isError: true, content: [{ type: "text", text: (err as Error)?.message || "Something went wrong." }] };
      }
    }) as never,
  );
}

const KIND_NAME: Record<MaterialKind, string> = {
  doc: "a page",
  image: "an image page",
  notebook: "a notebook",
  folder: "a folder",
  book: "a book",
  artifact: "an artifact",
};

/** The material, or a tool error naming the id (and the kind it should have been). */
export function needMaterial(id: string, kind?: MaterialKind): Material {
  const m = repo.getMaterial(id);
  if (!m) throw new UserError(`No material with id "${id}". Use get_tree or search to find ids.`);
  if (kind && m.kind !== kind) throw new UserError(`"${m.title}" is ${KIND_NAME[m.kind]}, not ${KIND_NAME[kind]}.`);
  return m;
}

export function needCourse(id: string) {
  const c = repo.getCourse(id);
  if (!c) throw new UserError(`No course with id "${id}". Use get_tree to find ids.`);
  return c;
}

/** Tells open tabs that a material's content changed (and the tree: titles, outlines). */
export function changed(m: Pick<MaterialSummary, "id" | "updatedAt"> | null) {
  if (m) emit({ type: "material", id: m.id, updatedAt: m.updatedAt });
  emit({ type: "tree" });
}

export const treeChanged = () => emit({ type: "tree" });

/** What a write returns: enough to carry on without another read. */
export const summary = (m: MaterialSummary) => ({
  id: m.id,
  kind: m.kind,
  title: m.title,
  courseId: m.courseId,
  parentId: m.parentId,
  updatedAt: m.updatedAt,
  outline: m.outline.map((o) => `${o.num} ${o.text}`),
});

// ── Page content in: Markdown, or raw blocks ─────────────────────────────

export const markdownField = z
  .string()
  .describe("Page content as Markdown (see the server instructions for math, callouts and @ mentions).");

/** BlockNote JSON blocks, the escape hatch: given ids are kept, missing ones are made. */
export const blocksField = z
  .array(z.record(z.string(), z.unknown()))
  .describe("Raw BlockNote blocks instead of Markdown (advanced; each needs a `type`).");

export function looseBlocks(raw: unknown[]): LooseBlock[] {
  return raw.map((r, i) => {
    const b = (r ?? {}) as Record<string, unknown>;
    if (typeof b.type !== "string" || !b.type) throw new UserError(`Block ${i + 1} has no type.`);
    return {
      ...b,
      id: typeof b.id === "string" && b.id ? b.id : nanoid(10),
      type: b.type,
      children: Array.isArray(b.children) ? looseBlocks(b.children) : [],
    } as LooseBlock;
  });
}

/** Blocks from `markdown` or `blocks` (one of them is required). */
export function contentIn(input: { markdown?: string; blocks?: unknown[] }, opts: ParseOptions = {}, what = "markdown or blocks"): LooseBlock[] {
  if (input.blocks) return looseBlocks(input.blocks);
  if (typeof input.markdown === "string") return markdownToBlocks(input.markdown, opts);
  throw new UserError(`Give ${what}.`);
}
