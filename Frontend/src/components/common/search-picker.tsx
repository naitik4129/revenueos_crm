import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "@/store/workspace-context";

export interface PickerOption {
  id: string;
  label: string;
  hint?: string | undefined;
}

/**
 * A button that opens a server-side search (lists can be thousands long). `search` returns
 * the matches for the typed text; the parent keeps the chosen option.
 */
export function SearchPicker({
  kind,
  value,
  onChange,
  search,
  placeholder,
  excludeId,
}: {
  /** Cache key namespace, e.g. "company-picker". */
  kind: string;
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  search: (text: string, signal: AbortSignal) => Promise<PickerOption[]>;
  placeholder: string;
  excludeId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { currentWorkspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: [kind, currentWorkspaceId, text],
    queryFn: ({ signal }) => search(text.trim(), signal),
    enabled: open && Boolean(currentWorkspaceId),
    placeholderData: (previous) => previous,
  });
  const options = (query.data ?? []).filter((option) => option.id !== excludeId);

  return (
    <div className="flex gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="flex-1 justify-between font-normal">
            <span className={value ? "truncate" : "truncate text-muted-foreground"}>
              {value?.label ?? placeholder}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
          <Command shouldFilter={false}>
            <CommandInput value={text} onValueChange={setText} placeholder="Type to search…" />
            <CommandList>
              <CommandEmpty>{query.isFetching ? "Searching…" : "No matches."}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    onSelect={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.hint && (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="icon" aria-label="Clear" onClick={() => onChange(null)}>
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
