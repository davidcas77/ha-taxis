// "just now", "5 min ago", "2 h ago": how long ago an ISO time was. One copy for
// the header and the Health page.
export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
