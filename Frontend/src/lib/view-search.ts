/** `?view=` on a list route: which tab the page opens on (the dashboard links use it). */
export function viewSearch(search: Record<string, unknown>): { view?: string } {
  const view = search["view"];
  return typeof view === "string" ? { view } : {};
}
