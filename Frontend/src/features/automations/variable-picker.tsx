import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TemplateVariable, TemplateVariableGroup } from "@/lib/backend-client";

const GROUPS: [TemplateVariableGroup, string][] = [
  ["contact", "Contact"],
  ["company", "Company"],
  ["deal", "Deal"],
  ["meeting", "Meeting (Meeting Scheduled templates only)"],
  ["date", "Date"],
];

/** "Insert variable" dropdown, grouped; the list comes from the backend renderer. */
export function VariablePicker({
  variables,
  onInsert,
  ariaLabel,
  className,
  disabled = false,
}: {
  variables: TemplateVariable[];
  onInsert: (token: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value="" disabled={disabled} onValueChange={onInsert}>
      <SelectTrigger aria-label={ariaLabel} className={className}>
        <SelectValue placeholder="Insert variable" />
      </SelectTrigger>
      <SelectContent>
        {GROUPS.map(([group, heading]) => {
          const items = variables.filter((v) => v.group === group);
          if (items.length === 0) return null;
          return (
            <SelectGroup key={group}>
              <SelectLabel className="text-xs text-muted-foreground">{heading}</SelectLabel>
              {items.map((v) => (
                <SelectItem key={v.token} value={v.token} className="text-xs">
                  {v.label}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
