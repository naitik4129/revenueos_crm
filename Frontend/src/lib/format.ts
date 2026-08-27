import { APP_TIME_ZONE, dateInputValue } from "./dates";

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export function fmtDate(iso?: string) {
  return iso ? dateFormatter.format(new Date(iso)) : "—";
}
export function fmtTime(iso?: string) {
  return iso ? timeFormatter.format(new Date(iso)) : "";
}
export function fmtDateTime(iso?: string) {
  return iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : "—";
}
export function dayOf(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function relDay(iso?: string) {
  if (!iso) return "—";
  const diff = dayDiff(dayOf(iso), dateInputValue());
  if (diff === 0) return `Today, ${fmtTime(iso)}`;
  if (diff === 1) return `Tomorrow, ${fmtTime(iso)}`;
  if (diff === -1) return `Yesterday, ${fmtTime(iso)}`;
  if (diff < 0) return `${fmtDate(iso)} (${Math.abs(diff)}d ago)`;
  return fmtDate(iso);
}
export function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}
export function isOverdue(iso?: string | null) {
  return Boolean(iso && Date.parse(iso) < Date.now());
}
export function isToday(iso?: string | null) {
  return Boolean(iso && dayOf(iso) === dateInputValue());
}
export function money(n: number) {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}
export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0] ?? "")
    .slice(0, 2)
    .join("");
}
