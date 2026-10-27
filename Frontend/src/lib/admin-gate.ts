/**
 * Where a signed-in user on an /admin path is sent, or null to stay. The Google Calendar OAuth
 * callback (Backend/src/routes/googleCalendarOAuth.routes.ts) always lands on
 * /admin?calendar=connected|error, but connections live at /settings, so that landing is
 * forwarded there for every role. Other admin pages are for admins only.
 */
export function adminPathRedirect(
  search: string,
  role: "admin" | "salesperson" | "client",
): string | null {
  if (search.includes("calendar=")) return `/settings${search}`;
  return role === "admin" ? null : "/";
}
