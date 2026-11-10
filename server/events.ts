// Changes made outside the browser (by agents over MCP), pushed to open tabs as
// Server-Sent Events so they reload what changed instead of overwriting it.
// Only the MCP layer emits: the browser never hears an echo of its own saves.
import { EventEmitter } from "node:events";
import type { RequestHandler } from "express";

export type GlossEvent =
  /** A material's content changed: tabs showing it reload it. */
  | { type: "material"; id: string; updatedAt: number }
  /** Courses, titles, order or the trash changed: tabs refetch the tree. */
  | { type: "tree" };

const bus = new EventEmitter();
bus.setMaxListeners(0);

export const emit = (e: GlossEvent) => void bus.emit("event", e);

/** `GET /api/events`: one stream per tab, with a comment every 25 s so proxies keep it open. */
export const eventStream: RequestHandler = (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  const send = (e: GlossEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
  bus.on("event", send);
  req.on("close", () => {
    clearInterval(ping);
    bus.off("event", send);
  });
};
