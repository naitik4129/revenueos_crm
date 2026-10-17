import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { backend, type AdminUser, type CrmRole } from "@/lib/backend-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListEmptyState, RecordTable, type ListColumn } from "@/components/common/list-controls";
import { Avatar } from "@/components/common/record-parts";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { fmtDate } from "@/lib/format";
import { useSession } from "@/store";
import { adminKeys, errorText } from "./admin-keys";
import { Field } from "./admin-shared";

const ROLE_LABEL: Record<CrmRole, string> = { admin: "Admin", salesperson: "Salesperson" };

export function UsersTab() {
  const client = useQueryClient();
  const { currentUser } = useSession();
  const users = useQuery({
    queryKey: adminKeys.users,
    queryFn: ({ signal }) => backend.admin.users.list(signal),
  });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: adminKeys.users }),
      client.invalidateQueries({ queryKey: ["profiles"] }),
    ]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CrmRole>("salesperson");
  const [q, setQ] = useState("");
  const create = useMutation({
    mutationFn: backend.admin.users.create,
    onSuccess: (user) => {
      void refresh();
      setEmail("");
      toast.success(`${user.name || user.email} now has CRM access.`);
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { role?: CrmRole; active?: boolean } }) =>
      backend.admin.users.update(id, input),
    onSuccess: () => {
      void refresh();
      toast.success("User updated.");
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ email: email.trim(), role });
  };

  // Admins cannot demote or deactivate themselves (the backend refuses it too).
  const locked = (user: AdminUser) =>
    currentUser?.id === user.id || (update.isPending && update.variables?.id === user.id);
  const query = q.trim().toLowerCase();
  const rows = (users.data?.data ?? []).filter(
    (u) => !query || `${u.name} ${u.email}`.toLowerCase().includes(query),
  );
  const columns: ListColumn<AdminUser>[] = [
    { id: "email", label: "Email", cell: (u) => u.email },
    {
      id: "role",
      label: "Role",
      cell: (u) => (
        <RoleSelect
          value={u.role}
          disabled={locked(u)}
          onChange={(next) => update.mutate({ id: u.id, input: { role: next } })}
        />
      ),
    },
    {
      id: "active",
      label: "Active",
      cell: (u) => (
        <Switch
          checked={u.active}
          disabled={locked(u)}
          aria-label={`Active: ${u.name || u.email}`}
          onCheckedChange={(active) => update.mutate({ id: u.id, input: { active } })}
        />
      ),
    },
    { id: "added", label: "Added", cell: (u) => fmtDate(u.createdAt) },
  ];

  return (
    <Card className="overflow-hidden p-0">
      <form
        className="flex flex-wrap items-end gap-3 border-b bg-muted/30 px-3 py-3"
        onSubmit={submit}
      >
        <div className="w-64">
          <Field label="Email">
            <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="New user's role">
          <RoleSelect value={role} onChange={setRole} />
        </Field>
        <Button disabled={create.isPending}>
          {create.isPending ? "Adding…" : "Give CRM access"}
        </Button>
        <p className="basis-full text-xs text-muted-foreground">
          For people who already have a RevenueOS account. New accounts are created on the platform,
          not here.
        </p>
      </form>
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email"
          aria-label="Search users"
          className="w-64"
        />
        {users.data && (
          <span className="ml-auto text-xs text-muted-foreground">
            {users.data.data.length} user{users.data.data.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {users.isLoading ? (
        <LoadingBlock label="Loading users…" />
      ) : users.error ? (
        <ErrorBlock error={users.error} />
      ) : rows.length === 0 ? (
        <ListEmptyState
          icon={Users}
          title={query ? "No users match." : "No CRM users yet"}
          text="Give an existing RevenueOS account CRM access with the form above."
        />
      ) : (
        <RecordTable
          rows={rows}
          columns={columns}
          rowLabel={(u) => u.name || u.email}
          name={(u) => (
            <div className="flex items-center gap-2.5">
              <Avatar name={u.name || u.email} />
              <span className="font-medium">
                {u.name || u.email}
                {currentUser?.id === u.id && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>
                )}
              </span>
            </div>
          )}
        />
      )}
    </Card>
  );
}

function RoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: CrmRole;
  disabled?: boolean;
  onChange: (role: CrmRole) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled ?? false}
      onValueChange={(v) => onChange(v as CrmRole)}
    >
      <SelectTrigger className="h-8 w-36" aria-label="Role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(ROLE_LABEL) as CrmRole[]).map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABEL[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
