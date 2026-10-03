// Pages save a moment after you stop typing. Before something reads the saved
// state (restoring a version, exporting), pending saves are sent first.

type Flusher = () => unknown;
const flushers = new Set<Flusher>();

export function registerFlusher(fn: Flusher) {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

export async function flushAll() {
  await Promise.all([...flushers].map((f) => f()));
}
