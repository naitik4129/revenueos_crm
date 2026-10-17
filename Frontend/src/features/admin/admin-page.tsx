import { PageHeader } from "@/app/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsersTab } from "./users-tab";
import { WorkspacesTab } from "./workspaces-tab";
import { MembersTab } from "./members-tab";
import { BrainKeysTab } from "./brain-keys-tab";

/** Admin only (the root route redirects everyone else; the backend checks every call). */
export function AdminPage() {
  return (
    <Tabs defaultValue="users" className="pb-10">
      <PageHeader
        title="Admin"
        description="CRM users, client workspaces, their members and brain API keys."
        tabs={
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="brain-keys">Brain API keys</TabsTrigger>
          </TabsList>
        }
      />
      <div className="px-6 py-4">
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="workspaces">
          <WorkspacesTab />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab />
        </TabsContent>
        <TabsContent value="brain-keys">
          <BrainKeysTab />
        </TabsContent>
      </div>
    </Tabs>
  );
}
