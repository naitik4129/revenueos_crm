import { useState } from "react";
import { PageHeader } from "@/app/app-shell";
import { ViewTabs } from "@/components/common/list-controls";
import { BrainKeysTab } from "./brain-keys-tab";
import { SendingTab } from "./sending-tab";

// Users, workspaces and members are managed on the RevenueOS platform (which owns projects and
// access); the CRM admin keeps only the operational settings below.
const TABS = [
  { id: "brain-keys", label: "Brain API keys" },
  { id: "sending", label: "Sending" },
];

/** Admin only (the root route redirects everyone else; the backend checks every call). */
export function AdminPage() {
  const [tab, setTab] = useState("brain-keys");
  return (
    <div className="pb-10">
      <PageHeader
        title="Admin"
        description="Brain API keys and sending limits. Users, workspaces and access are managed on the RevenueOS platform."
        tabs={<ViewTabs views={TABS} active={tab} onSelect={setTab} />}
      />
      <div className="px-6 py-4">
        {tab === "brain-keys" && <BrainKeysTab />}
        {tab === "sending" && <SendingTab />}
      </div>
    </div>
  );
}
