import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdminUser } from "@/lib/backend-client";

const NONE = "none";

/** Default handover owner: an active salesperson member, or nobody. */
export function DefaultOwnerSelect({
  value,
  members,
  disabled,
  onChange,
}: {
  value: string | null;
  members: AdminUser[];
  disabled?: boolean;
  onChange: (userId: string | null) => void;
}) {
  // The current owner stays visible even if later deactivated, so the select never goes blank.
  const options = members.filter((member) => member.active || member.id === value);
  return (
    <Select
      value={value ?? NONE}
      disabled={disabled ?? false}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
    >
      <SelectTrigger aria-label="Default owner">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No default owner</SelectItem>
        {options.map((member) => (
          <SelectItem key={member.id} value={member.id}>
            {member.name || member.email}
            {member.active ? "" : " (inactive)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
