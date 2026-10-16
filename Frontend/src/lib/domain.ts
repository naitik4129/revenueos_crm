/**
 * Mirrors Backend companies.service normalizeDomain: "https://www.Acme.com/about" -> "acme.com".
 * Null when nothing usable is left.
 */
export function normalizeDomain(value: string | null | undefined): string | null {
  const v = value
    ?.trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return v && v.includes(".") ? v : null;
}
