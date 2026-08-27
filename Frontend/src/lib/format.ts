import { TODAY } from "@/mocks/seed";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parse(iso: string) {
  const parts = iso.split("T");
  const date = parts[0] ?? "1970-01-01";
  const time = parts[1] ?? "00:00:00";
  const [y = 1970, m = 1, dd = 1] = date.split("-").map(Number);
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  return { y, m, dd, hh, mm };
}

export function fmtDate(iso?: string) {
  if (!iso) return "—";
  const { m, dd, y } = parse(iso);
  return `${dd} ${MONTHS[m - 1] ?? ""} ${y}`;
}

export function fmtTime(iso?: string) {
  if (!iso) return "";
  const { hh, mm } = parse(iso);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

export function fmtDateTime(iso?: string) {
  if (!iso) return "—";
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}

export function dayOf(iso: string) {
  return iso.split("T")[0] ?? iso;
}

/** Friendly relative label against the fixed prototype clock. */
export function relDay(iso?: string) {
  if (!iso) return "—";
  const diff = dayDiff(dayOf(iso), TODAY);
  if (diff === 0) return `Today, ${fmtTime(iso)}`;
  if (diff === 1) return `Tomorrow, ${fmtTime(iso)}`;
  if (diff === -1) return `Yesterday, ${fmtTime(iso)}`;
  if (diff < 0) return `${fmtDate(iso)} (${Math.abs(diff)}d ago)`;
  return fmtDate(iso);
}

export function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

export function isOverdue(iso?: string | null) {
  if (!iso) return false;
  return Date.parse(`${iso}Z`) < Date.parse(`${TODAY}T12:00:00Z`);
}

export function isToday(iso?: string | null) {
  return !!iso && dayOf(iso) === TODAY;
}

export function money(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0] ?? "")
    .slice(0, 2)
    .join("");
}
