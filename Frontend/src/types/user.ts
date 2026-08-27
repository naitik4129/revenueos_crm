export type Role = "Salesperson" | "Manager" | "Admin";

export interface User {
  id: string;
  name: string;
  initials: string;
  role: Role;
  email: string;
}
