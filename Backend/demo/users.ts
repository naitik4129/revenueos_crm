/** DEMO MODE ONLY. The three demo users (every password is "demo"). */
export interface DemoUserInfo {
  id: string;
  email: string;
  name: string;
  role: "admin" | "salesperson";
}

/** Fixed ids so a browser session from an earlier demo run still names a known user. */
export const DEMO_USERS: DemoUserInfo[] = [
  { id: "d0000000-0000-4000-8000-000000000001", email: "admin@demo.local", name: "Asha Admin", role: "admin" },
  { id: "d0000000-0000-4000-8000-000000000002", email: "sam@demo.local", name: "Sam Sales", role: "salesperson" },
  { id: "d0000000-0000-4000-8000-000000000003", email: "priya@demo.local", name: "Priya Sales", role: "salesperson" },
];
