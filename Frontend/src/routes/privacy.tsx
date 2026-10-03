import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPage } from "@/features/legal/privacy-page";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy - MOTM Flow" },
      {
        name: "description",
        content:
          "How MOTM Flow collects, uses and protects your information, including Google Calendar data.",
      },
      { property: "og:title", content: "Privacy Policy - MOTM Flow" },
    ],
  }),
  component: PrivacyPage,
});
