import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { backend, type AdminUser } from "@/lib/backend-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ListEmptyState, RecordTable } from "@/components/common/list-controls";
import { Avatar } from "@/components/common/record-parts";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { StatusBadge } from "@/components/common/status-badge";
import { keys } from "@/store/query";
import { useWorkspace } from "@/store/workspace-context";
import { adminKeys, errorText } from "./admin-keys";
import { WorkspacePicker } from "./admin-shared";

/** Salespeople per workspace. Admins need no membership: they see every workspace. */
export function MembersTab() {
  const { workspaces } = useWorkspace();
  const [picked, setPicked] = useState<string | null>(null);
  const workspaceId = picked ?? workspaces[0]?.id ?? null;
  const users = useQuery({
    queryKey: adminKeys.users,
    queryFn: ({ signal }) => backend.admin.users.list(signal),
  });
  const members = useQuery({
    queryKey: adminKeys.members(workspaceId ?? ""),
    queryFn: ({ signal }) => backend.workspaces.members(workspaceId!, signal),
    enabled: Boolean(workspaceId),
  });
  const salespeople = (users.data?.data ?? []).filter((user) => user.role === "salesperson");
  const picker = (
    <WorkspacePicker workspaces={workspaces} value={workspaceId} onChange={setPicked} />
  );

  return (
    <Card className="overflow-hidden p-0">
      {!workspaceId ? (
        <ListEmptyState
          icon={Users}
          title="No workspaces yet"
          text="Create a workspace on the Workspaces tab first."
        />
      ) : users.isLoading || members.isLoading ? (
        <>
          <Toolbar>{picker}</Toolbar>
          <LoadingBlock label="Loading members…" />
        </>
      ) : users.error || members.error ? (
        <>
          <Toolbar>{picker}</Toolbar>
          <ErrorBlock error={users.error ?? members.error} />
        </>
      ) : (
        <MemberChecklist
          // Starts again from the saved list whenever it changes.
          key={`${workspaceId}:${members.dataUpdatedAt}`}
          picker={picker}
          workspaceId={workspaceId}
          salespeople={salespeople}
          memberIds={(members.data?.data ?? []).map((member) => member.id)}
        />
      )}
    </Card>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">{children}</div>
  );
}

function MemberChecklist({
  picker,
  workspaceId,
  salespeople,
  memberIds,
}: {
  picker: React.ReactNode;
  workspaceId: string;
  salespeople: AdminUser[];
  memberIds: string[];
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState(() => new Set(memberIds));
  const save = useMutation({
    mutationFn: () => backend.workspaces.setMembers(workspaceId, [...selected]),
    onSuccess: () => {
      // Removing the default owner clears it, so the workspace list is refreshed too.
      void client.invalidateQueries({ queryKey: adminKeys.members(workspaceId) });
      void client.invalidateQueries({ queryKey: keys.workspaces });
      toast.success("Members saved.");
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const dirty = selected.size !== memberIds.length || memberIds.some((id) => !selected.has(id));
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      <Toolbar>
        {picker}
        <span className="text-xs text-muted-foreground">
          {selected.size} of {salespeople.length} salespeople are members
          {dirty && " · unsaved changes"}
        </span>
        <Button
          size="sm"
          className="ml-auto"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save members"}
        </Button>
      </Toolbar>
      {salespeople.length === 0 ? (
        <ListEmptyState
          icon={Users}
          title="No salespeople yet"
          text="Add them on the Users tab, then tick who works on this workspace."
        />
      ) : (
        <RecordTable
          rows={salespeople}
          nameHeader="Member"
          rowLabel={(u) => u.name || u.email}
          columns={[
            { id: "email", label: "Email", cell: (u) => u.email },
            {
              id: "status",
              label: "Status",
              cell: (u) => (u.active ? undefined : <StatusBadge value="inactive" tone="muted" />),
            },
          ]}
          name={(u) => (
            <label className="flex cursor-pointer items-center gap-2.5">
              <Checkbox
                checked={selected.has(u.id)}
                onCheckedChange={(on) => toggle(u.id, on === true)}
              />
              <Avatar name={u.name || u.email} />
              <span className="font-medium">{u.name || u.email}</span>
            </label>
          )}
        />
      )}
    </>
  );
}
