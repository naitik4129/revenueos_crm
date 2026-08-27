import type { User } from "@/types";

export const currentUserId = "u1";

export const users: User[] = [
  { id: "u1", name: "Amit Shah", initials: "AS", role: "Manager", email: "amit@northbeam.io" },
  {
    id: "u2",
    name: "Priya Mehta",
    initials: "PM",
    role: "Salesperson",
    email: "priya@northbeam.io",
  },
  {
    id: "u3",
    name: "Vikram Rao",
    initials: "VR",
    role: "Salesperson",
    email: "vikram@northbeam.io",
  },
  {
    id: "u4",
    name: "Sneha Iyer",
    initials: "SI",
    role: "Salesperson",
    email: "sneha@northbeam.io",
  },
];

/**
 * The signed-in user. Resolved once here rather than with a non-null assertion
 * at every call site — when auth lands this is the seam that reads the session.
 */
export const currentUser: User = (() => {
  const user = users.find((u) => u.id === currentUserId);
  if (!user) throw new Error(`Seed error: currentUserId "${currentUserId}" is not in users`);
  return user;
})();
