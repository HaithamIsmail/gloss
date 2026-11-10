// Keeping open tabs in step with edits made elsewhere (agents over MCP).
// - The server streams changes on /api/events; a changed material that is open
//   drops its pending save, is refetched, and its view remounts with the new content.
// - Every content save carries the `updatedAt` this tab last saw, and the server
//   refuses (409) a save based on older content, which takes the same path.
import type { Material } from "../shared/api";
import { keys, queryClient } from "./api";
import { useUI } from "./store";
import { toast } from "./toast";

/** The newest `updatedAt` this tab has seen for each material (from a fetch or a save). */
const base = new Map<string, number>();

export const baseOf = (id: string) => base.get(id);

export function seen(id: string, updatedAt: number) {
  if (updatedAt > (base.get(id) ?? 0)) base.set(id, updatedAt);
}

/** Open editors register how to drop their pending save, so a reload doesn't write stale content back. */
const savers = new Map<string, Set<() => void>>();

export function registerSaver(id: string, discard: () => void) {
  const set = savers.get(id) ?? new Set();
  set.add(discard);
  savers.set(id, set);
  return () => {
    set.delete(discard);
    if (!set.size) savers.delete(id);
  };
}

// Kinds whose views keep the content in local state; books merge on the server and artifacts poll.
const RELOADED = new Set(["doc", "notebook", "image"]);

/** Refetches a material and, if it is open, remounts its view with the stored content. */
export async function reloadMaterial(id: string, message: string) {
  savers.get(id)?.forEach((discard) => discard());
  const open = savers.has(id);
  const fresh = await queryClient.fetchQuery({
    queryKey: keys.material(id),
    queryFn: () => fetch(`/api/materials/${id}`).then((r) => (r.ok ? (r.json() as Promise<Material>) : Promise.reject(new Error("gone")))),
    staleTime: 0,
  });
  seen(id, fresh.updatedAt);
  void queryClient.invalidateQueries({ queryKey: keys.versions(id) });
  useUI.getState().bumpMaterial(id);
  if (open) toast(message);
}

type GlossEvent = { type: "material"; id: string; updatedAt: number } | { type: "tree" };

function onEvent(e: GlossEvent) {
  if (e.type === "tree") {
    for (const key of [keys.tree, keys.books, keys.trash]) void queryClient.invalidateQueries({ queryKey: key });
    return;
  }
  if (e.updatedAt <= (base.get(e.id) ?? 0)) return; // already have it
  const cached = queryClient.getQueryData<Material>(keys.material(e.id));
  if (!cached) return;
  if (!RELOADED.has(cached.kind)) return void queryClient.invalidateQueries({ queryKey: keys.material(e.id) });
  void reloadMaterial(e.id, "Updated by an agent.").catch(() => undefined);
}

/** One stream for the app's lifetime; EventSource reconnects on its own. */
export function startEvents() {
  const source = new EventSource("/api/events");
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as GlossEvent);
    } catch {
      // ignore a malformed event
    }
  };
  return () => source.close();
}
