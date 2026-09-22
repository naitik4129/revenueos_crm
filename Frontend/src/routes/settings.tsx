import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceSettingsPage } from "@/features/settings/workspace-settings-page";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings - MOTM Flow" },
      {
        name: "description",
        content: "Email, WhatsApp, and Google Calendar connections for the current workspace.",
      },
      { property: "og:title", content: "Settings - MOTM Flow" },
      {
        property: "og:description",
        content: "Configure how this workspace sends email, WhatsApp, and calendar invites.",
      },
    ],
  }),
  component: WorkspaceSettingsPage,
});
