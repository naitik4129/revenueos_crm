export const APP_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

export function nowIso() {
  return new Date().toISOString();
}
export function toIsoFromIst(date: string, time = "10:00:00") {
  return new Date(`${date}T${time}${IST_OFFSET}`).toISOString();
}
export function dateInputValue(daysFromToday = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + daysFromToday * 86_400_000));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function addDays(days: number, time = "10:00:00") {
  return toIsoFromIst(dateInputValue(days), time);
}
