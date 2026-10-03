// The server can run code in your Python environments, so it only answers
// requests that come from this machine and from this app's own pages.
// - Host must be localhost (blocks DNS-rebinding tricks).
// - Origin, when present, must be localhost too (blocks other websites, which
//   could otherwise post to localhost or open a WebSocket to it).
// Extra host names can be allowed with ALLOWED_HOSTS=name1,name2.
import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const extra = new Set(
  (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

const hostname = (host: string) => host.toLowerCase().replace(/:\d+$/, "");
const hostOk = (host: string | undefined) => !!host && (LOCAL.has(hostname(host)) || extra.has(hostname(host)));

function originOk(origin: string | undefined) {
  if (!origin) return true;
  try {
    return hostOk(new URL(origin).host);
  } catch {
    return false;
  }
}

export const localOnly: RequestHandler = (req, res, next) => {
  if (hostOk(req.headers.host) && originOk(req.headers.origin)) return next();
  res.status(403).json({ error: "Requests are only accepted from this computer." });
};

/** WebSocket upgrades: browsers always send an Origin, and it must be local. */
export const isLocalUpgrade = (req: IncomingMessage) =>
  hostOk(req.headers.host) && !!req.headers.origin && originOk(req.headers.origin);
