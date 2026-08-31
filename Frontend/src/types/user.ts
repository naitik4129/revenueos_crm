export interface User {
  id: string;
  name: string;
  initials: string;
  role: "Admin" | "Salesperson";
  email: string;
  active: boolean;
}
