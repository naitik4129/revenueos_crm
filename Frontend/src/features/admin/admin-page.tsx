import { useState } from "react";
import { PageHeader } from "@/app/app-shell";
import { ViewTabs } from "@/components/common/list-controls";
import { UsersTab } from "./users-tab";
import { WorkspacesTab } from "./workspaces-tab";
import { MembersTab } from "./members-tab";
import { BrainKeysTab } from "./brain-keys-tab";

const TABS = [
  { id: "users", label: "Users" },
  { id: "workspaces", label: "Workspaces" },
  { id: "members", label: "Members" },
  { id: "brain-keys", label: "Brain API keys" },
];

/** Admin only (the root route redirects everyone else; the backend checks every call). */
export function AdminPage() {
  const [tab, setTab] = useState("users");
  return (
    <div className="pb-10">
      <PageHeader
        title="Admin"
        description="CRM users, client workspaces, their members and brain API keys."
        tabs={<ViewTabs views={TABS} active={tab} onSelect={setTab} />}
      />
      <div className="px-6 py-4">
        {tab === "users" && <UsersTab />}
        {tab === "workspaces" && <WorkspacesTab />}
        {tab === "members" && <MembersTab />}
        {tab === "brain-keys" && <BrainKeysTab />}
      </div>
    </div>
  );
}
