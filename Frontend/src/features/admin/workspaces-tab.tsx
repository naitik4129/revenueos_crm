import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { backend, type UpdateWorkspaceInput, type Workspace } from "@/lib/backend-client";
import { Button } from "@/components/ui/button";
import { Building } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ListEmptyState } from "@/components/common/list-controls";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { keys } from "@/store/query";
import { useWorkspace } from "@/store/workspace-context";
import { adminKeys, errorText } from "./admin-keys";
import { Field } from "./admin-shared";
import { DefaultOwnerSelect } from "./default-owner-select";

export function WorkspacesTab() {
  const client = useQueryClient();
  const { workspaces } = useWorkspace();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const create = useMutation({
    mutationFn: () => backend.workspaces.create(name.trim(), projectId.trim() || null),
    onSuccess: (workspace) => {
      void client.invalidateQueries({ queryKey: keys.workspaces });
      setName("");
      setProjectId("");
      toast.success(`Workspace "${workspace.name}" created.`);
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Card className="overflow-hidden p-0">
      <form
        className="flex flex-wrap items-end gap-3 border-b bg-muted/30 px-3 py-3"
        onSubmit={submit}
      >
        <div className="w-56">
          <Field label="Name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="w-72">
          <Field label="Platform project id (optional)">
            <Input value={projectId} onChange={(e) => setProjectId(e.target.value)} />
          </Field>
        </div>
        <Button disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create workspace"}
        </Button>
        <p className="basis-full text-xs text-muted-foreground">
          One workspace per client project.
        </p>
      </form>
      <div className="flex min-h-11 items-center border-b px-3 py-2 text-xs text-muted-foreground">
        {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
      </div>
      {workspaces.length === 0 ? (
        <ListEmptyState
          icon={Building}
          title="No workspaces yet"
          text="Create one per client project with the form above."
        />
      ) : (
        <div className="divide-y">
          {workspaces.map((workspace) => (
            // Re-mounts after a save, so the fields show the saved values.
            <WorkspaceEditor key={`${workspace.id}:${workspace.updatedAt}`} workspace={workspace} />
          ))}
        </div>
      )}
    </Card>
  );
}

function WorkspaceEditor({ workspace }: { workspace: Workspace }) {
  const client = useQueryClient();
  const [name, setName] = useState(workspace.name);
  const [projectId, setProjectId] = useState(workspace.platformProjectId ?? "");
  const members = useQuery({
    queryKey: adminKeys.members(workspace.id),
    queryFn: ({ signal }) => backend.workspaces.members(workspace.id, signal),
  });
  const update = useMutation({
    mutationFn: (input: UpdateWorkspaceInput) => backend.workspaces.update(workspace.id, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.workspaces });
      toast.success("Workspace saved.");
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const dirty =
    name.trim() !== workspace.name || projectId.trim() !== (workspace.platformProjectId ?? "");

  return (
    <div className="grid gap-3 px-3 py-3 hover:bg-accent/30 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Platform project id">
        <Input
          value={projectId}
          placeholder="Not linked"
          onChange={(e) => setProjectId(e.target.value)}
        />
      </Field>
      <Field label="Default owner">
        <DefaultOwnerSelect
          value={workspace.defaultOwnerId}
          members={members.data?.data ?? []}
          disabled={update.isPending || members.isLoading}
          onChange={(defaultOwnerId) => update.mutate({ defaultOwnerId })}
        />
      </Field>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={workspace.isActive}
            disabled={update.isPending}
            aria-label={`Active: ${workspace.name}`}
            onCheckedChange={(isActive) => update.mutate({ isActive })}
          />
          Active
        </label>
        <Button
          size="sm"
          disabled={!dirty || !name.trim() || update.isPending}
          onClick={() =>
            update.mutate({ name: name.trim(), platformProjectId: projectId.trim() || null })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}
