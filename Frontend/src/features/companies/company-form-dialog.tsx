import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { backend, BackendError, type CompanyInput } from "@/lib/backend-client";
import { normalizeDomain } from "@/lib/domain";
import { messageFromError, useCrmMutation, useSession } from "@/store";
import type { Company } from "@/types";

const UNASSIGNED = "unassigned";

function initialForm(company: Company | undefined) {
  return {
    name: company?.name ?? "",
    website: company?.website ?? "",
    domain: company?.domain ?? "",
    industry: company?.industry ?? "",
    headcount: company?.headcount?.toString() ?? "",
    phone: company?.phone ?? "",
    city: company?.city ?? "",
    country: company?.country ?? "",
    location: company?.location ?? "",
    linkedinUrl: company?.linkedinUrl ?? "",
    ownerId: company?.ownerId ?? UNASSIGNED,
  };
}
type Form = ReturnType<typeof initialForm>;

/** Add a company (no `company`) or edit one. */
export function CompanyFormDialog({
  open,
  onOpenChange,
  company,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: Company;
}) {
  const { users } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => initialForm(company));
  // The domain follows the website until someone types a domain of their own.
  const [domainTyped, setDomainTyped] = useState(Boolean(company?.domain));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Form, string | undefined>>>(
    {},
  );

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(company));
    setDomainTyped(Boolean(company?.domain));
    setFieldErrors({});
  }, [open, company]);

  const save = useCrmMutation((input: CompanyInput) =>
    company ? backend.companies.update(company.id, input) : backend.companies.create(input),
  );

  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({
      ...f,
      [k]: v,
      ...(k === "website" && !domainTyped ? { domain: normalizeDomain(v) ?? "" } : {}),
    }));
    setFieldErrors((e) => ({
      ...e,
      [k]: undefined,
      ...(k === "website" ? { domain: undefined } : {}),
    }));
  };

  const headcount = form.headcount.trim() === "" ? null : Number(form.headcount);
  const localErrors: Partial<Record<keyof Form, string>> = {
    ...(!form.name.trim() ? { name: "Company name is required." } : {}),
    ...(headcount !== null && !(Number.isInteger(headcount) && headcount >= 0)
      ? { headcount: "Enter a whole number." }
      : {}),
    ...(form.domain.trim() && !normalizeDomain(form.domain)
      ? { domain: "Enter a domain like acme.com." }
      : {}),
  };
  // Errors show after Save is pressed (local checks) or the backend rejects a field.
  const errorFor = (k: keyof Form) => fieldErrors[k];

  const submit = async () => {
    if (Object.keys(localErrors).length > 0) return setFieldErrors(localErrors);
    try {
      // Strings, not undefined: "" clears a field on edit.
      const saved = await save.mutateAsync({
        name: form.name.trim(),
        website: form.website.trim(),
        domain: normalizeDomain(form.domain),
        industry: form.industry.trim(),
        headcount,
        phone: form.phone.trim(),
        city: form.city.trim(),
        country: form.country.trim(),
        location: form.location.trim(),
        linkedinUrl: form.linkedinUrl.trim(),
        ownerId: form.ownerId === UNASSIGNED ? null : form.ownerId,
      });
      toast.success(company ? "Company updated" : "Company created");
      onOpenChange(false);
      if (!company) void navigate({ to: "/companies/$companyId", params: { companyId: saved.id } });
    } catch (error) {
      // e.g. 409 "A company with this domain already exists" -> shown under Domain.
      const field =
        error instanceof BackendError
          ? (error.details as { field?: unknown } | undefined)?.field
          : null;
      if (typeof field === "string" && field in form)
        setFieldErrors({ [field]: messageFromError(error) });
      else toast.error(messageFromError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{company ? "Edit company" : "Add company"}</DialogTitle>
          <DialogDescription>
            The domain is taken from the website and must be unique in this workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2" error={errorFor("name")}>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              aria-invalid={Boolean(errorFor("name"))}
            />
          </Field>
          <Field label="Website">
            <Input
              value={form.website}
              placeholder="https://acme.com"
              onChange={(e) => set("website", e.target.value)}
            />
          </Field>
          <Field label="Domain" error={errorFor("domain")}>
            <Input
              value={form.domain}
              placeholder="acme.com"
              onChange={(e) => {
                setDomainTyped(true);
                set("domain", e.target.value);
              }}
              aria-invalid={Boolean(errorFor("domain"))}
            />
          </Field>
          <Field label="Industry">
            <Input value={form.industry} onChange={(e) => set("industry", e.target.value)} />
          </Field>
          <Field label="Headcount" error={errorFor("headcount")}>
            <Input
              inputMode="numeric"
              value={form.headcount}
              onChange={(e) => set("headcount", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="LinkedIn URL">
            <Input value={form.linkedinUrl} onChange={(e) => set("linkedinUrl", e.target.value)} />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="Country">
            <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
          </Field>
          <Field label="Location">
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
          </Field>
          <Field label="Owner">
            <Select value={form.ownerId} onValueChange={(v) => set("ownerId", v)}>
              <SelectTrigger aria-label="Owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => void submit()}>
            {save.isPending ? "Saving…" : company ? "Save" : "Create company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label: text,
  children,
  className,
  error,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  error?: string | undefined;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs">{text}</Label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
