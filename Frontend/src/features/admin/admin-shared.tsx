import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Workspace } from "@/lib/backend-client";

/** A labelled form control; the wrapping <label> ties the text to the control. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium leading-none">{label}</span>
      {children}
    </label>
  );
}

/** Picks the workspace a tab works on (admins see every workspace). */
export function WorkspacePicker({
  workspaces,
  value,
  onChange,
}: {
  workspaces: Workspace[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger className="w-64" aria-label="Workspace">
        <SelectValue placeholder="Choose a workspace" />
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((workspace) => (
          <SelectItem key={workspace.id} value={workspace.id}>
            {workspace.name}
            {workspace.isActive ? "" : " (inactive)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
