import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { backend, type AdminUser } from "@/lib/backend-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
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

  return (
    <div className="space-y-4">
      <WorkspacePicker workspaces={workspaces} value={workspaceId} onChange={setPicked} />
      {!workspaceId ? (
        <p className="text-sm text-muted-foreground">Create a workspace first.</p>
      ) : users.isLoading || members.isLoading ? (
        <LoadingBlock label="Loading members…" />
      ) : users.error || members.error ? (
        <ErrorBlock error={users.error ?? members.error} />
      ) : (
        <MemberChecklist
          // Starts again from the saved list whenever it changes.
          key={`${workspaceId}:${members.dataUpdatedAt}`}
          workspaceId={workspaceId}
          salespeople={salespeople}
          memberIds={(members.data?.data ?? []).map((member) => member.id)}
        />
      )}
    </div>
  );
}

function MemberChecklist({
  workspaceId,
  salespeople,
  memberIds,
}: {
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
    <Card>
      <CardContent className="space-y-3 p-4">
        {salespeople.length === 0 && (
          <p className="text-sm text-muted-foreground">No salespeople yet. Add them on Users.</p>
        )}
        {salespeople.map((user) => (
          <label key={user.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.has(user.id)}
              onCheckedChange={(on) => toggle(user.id, on === true)}
            />
            <span>{user.name || user.email}</span>
            <span className="text-xs text-muted-foreground">{user.email}</span>
            {!user.active && <span className="text-xs text-muted-foreground">(inactive)</span>}
          </label>
        ))}
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save members"}
        </Button>
      </CardContent>
    </Card>
  );
}
