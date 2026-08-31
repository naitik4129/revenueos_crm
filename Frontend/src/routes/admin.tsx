import { createFileRoute } from "@tanstack/react-router";
import { AdminPage } from "@/features/admin/admin-page";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Northbeam CRM" }] }),
  component: AdminPage,
});
