const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** "Today 14:05", "Yesterday 09:12", "Mon 3 Oct 14:05", "3 Oct 2025 14:05". */
export function formatWhen(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `Today ${time(d)}`;
  if (diff === 1) return `Yesterday ${time(d)}`;
  if (diff < 7) return `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${time(d)}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} ${time(d)}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86_400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Starts a file download without leaving the page. */
export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
