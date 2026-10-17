import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { backend, type BrainKey } from "@/lib/backend-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ListEmptyState, RecordTable } from "@/components/common/list-controls";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { StatusBadge } from "@/components/common/status-badge";
import { fmtDate, relDay } from "@/lib/format";
import { useWorkspace } from "@/store/workspace-context";
import { adminKeys, errorText } from "./admin-keys";
import { WorkspacePicker } from "./admin-shared";

/** Per-workspace service keys for the RevenueOS brain's /brain/v1 API. */
export function BrainKeysTab() {
  const client = useQueryClient();
  const { workspaces } = useWorkspace();
  const [picked, setPicked] = useState<string | null>(null);
  const workspaceId = picked ?? workspaces[0]?.id ?? null;
  const [label, setLabel] = useState("");
  // The full key exists only in the create response; it is dropped when the dialog closes.
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<BrainKey | null>(null);
  const list = useQuery({
    queryKey: adminKeys.brainKeys(workspaceId ?? ""),
    queryFn: ({ signal }) => backend.workspaces.brainKeys.list(workspaceId!, signal),
    enabled: Boolean(workspaceId),
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: adminKeys.brainKeys(workspaceId ?? "") });
  const create = useMutation({
    mutationFn: () => backend.workspaces.brainKeys.create(workspaceId!, label.trim()),
    onSuccess: (created) => {
      void refresh();
      setLabel("");
      setNewKey(created.key);
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const revoke = useMutation({
    mutationFn: (keyId: string) => backend.workspaces.brainKeys.revoke(workspaceId!, keyId),
    onSuccess: () => {
      void refresh();
      setRevoking(null);
      toast.success("Key revoked.");
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <div>
      <Card className="overflow-hidden p-0">
        <div className="flex min-h-14 flex-wrap items-center gap-3 border-b px-3 py-2">
          <WorkspacePicker workspaces={workspaces} value={workspaceId} onChange={setPicked} />
          {workspaceId && (
            <form className="ml-auto flex gap-2" onSubmit={submit}>
              <Input
                required
                className="w-56"
                placeholder="Label, e.g. RevenueOS brain"
                aria-label="Key label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <Button disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create key"}
              </Button>
            </form>
          )}
        </div>

        {!workspaceId ? (
          <ListEmptyState
            icon={KeyRound}
            title="No workspaces yet"
            text="Create a workspace on the Workspaces tab first."
          />
        ) : list.isLoading ? (
          <LoadingBlock label="Loading keys…" />
        ) : list.error ? (
          <ErrorBlock error={list.error} />
        ) : (list.data?.data ?? []).length === 0 ? (
          <ListEmptyState
            icon={KeyRound}
            title="No keys for this workspace."
            text="The brain pushes companies, contacts, calls and handovers with a key. Create one above; its full value is shown once."
          />
        ) : (
          <RecordTable
            rows={list.data?.data ?? []}
            nameHeader="Label"
            rowLabel={(key) => key.label}
            name={(key) => <span className="font-medium">{key.label}</span>}
            columns={[
              {
                id: "key",
                label: "Key",
                cell: (key) => <span className="font-mono">{`${key.prefix}…`}</span>,
              },
              { id: "created", label: "Created", cell: (key) => fmtDate(key.createdAt) },
              {
                id: "used",
                label: "Last used",
                cell: (key) => (key.lastUsedAt ? relDay(key.lastUsedAt) : "Never"),
              },
              {
                id: "status",
                label: "Status",
                cell: (key) => (
                  <StatusBadge
                    value={key.revokedAt ? "revoked" : "active"}
                    tone={key.revokedAt ? "muted" : "success"}
                  />
                ),
              },
            ]}
            actions={(key) =>
              !key.revokedAt && (
                <Button size="sm" variant="ghost" onClick={() => setRevoking(key)}>
                  Revoke
                </Button>
              )
            }
          />
        )}
      </Card>

      <Dialog open={newKey !== null} onOpenChange={(open) => !open && setNewKey(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Copy the new key now</DialogTitle>
            <DialogDescription>
              It is shown only once. Store it in the brain's settings; if it is lost, revoke it and
              create a new one.
            </DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-md border bg-muted px-3 py-2 text-xs">
            {newKey}
          </code>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(newKey ?? "")
                  .then(() => toast.success("Key copied."))
                  .catch(() => toast.error("Could not copy; select the key and copy it."))
              }
            >
              <Copy className="mr-1 size-4" /> Copy key
            </Button>
            <Button onClick={() => setNewKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this key?"
        description={`"${revoking?.label ?? ""}" stops working immediately. The brain needs a new key to keep pushing data.`}
        confirmLabel="Revoke"
        disabled={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </div>
  );
}
