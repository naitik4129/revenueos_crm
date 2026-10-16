import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { backend, type AdminUser, type CrmRole } from "@/lib/backend-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { fmtDate } from "@/lib/format";
import { useSession } from "@/store";
import { adminKeys, errorText } from "./admin-keys";
import { Field } from "./admin-shared";

const ROLE_LABEL: Record<CrmRole, string> = { admin: "Admin", salesperson: "Salesperson" };

export function UsersTab() {
  const client = useQueryClient();
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
  const create = useMutation({
    mutationFn: backend.admin.users.create,
    onSuccess: (user) => {
      void refresh();
      setEmail("");
      toast.success(`${user.name || user.email} now has CRM access.`);
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ email: email.trim(), role });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Add a user</CardTitle>
          <CardDescription>
            For people who already have a RevenueOS account. New accounts are created on the
            platform, not here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Email">
              <Input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Role">
              <RoleSelect value={role} onChange={setRole} />
            </Field>
            <Button className="w-full" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Give CRM access"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {users.isLoading ? (
        <LoadingBlock label="Loading users…" />
      ) : users.error ? (
        <ErrorBlock error={users.error} />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  {["Name", "Email", "Role", "Active", "Added"].map((heading) => (
                    <th key={heading} className="px-3 py-2 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(users.data?.data ?? []).map((user) => (
                  <UserRow key={user.id} user={user} onSaved={refresh} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function UserRow({ user, onSaved }: { user: AdminUser; onSaved: () => Promise<unknown> }) {
  const { currentUser } = useSession();
  // Admins cannot demote or deactivate themselves (the backend refuses it too).
  const isSelf = currentUser?.id === user.id;
  const update = useMutation({
    mutationFn: (input: { role?: CrmRole; active?: boolean }) =>
      backend.admin.users.update(user.id, input),
    onSuccess: () => {
      void onSaved();
      toast.success("User updated.");
    },
    onError: (error) => toast.error(errorText(error)),
  });
  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        {user.name || user.email}
        {isSelf && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{user.email}</td>
      <td className="px-3 py-2">
        <RoleSelect
          value={user.role}
          disabled={isSelf || update.isPending}
          onChange={(role) => update.mutate({ role })}
        />
      </td>
      <td className="px-3 py-2">
        <Switch
          checked={user.active}
          disabled={isSelf || update.isPending}
          aria-label={`Active: ${user.name || user.email}`}
          onCheckedChange={(active) => update.mutate({ active })}
        />
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(user.createdAt)}</td>
    </tr>
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
