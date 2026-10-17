import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { PickerOption } from "@/components/common/search-picker";
import { backend, BackendError, type ContactInput } from "@/lib/backend-client";
import {
  normalizeEmail,
  normalizePhone,
  validateContact,
  type ContactFormErrors,
} from "@/lib/contact-validation";
import { label } from "@/lib/labels";
import { messageFromError, useCrmMutation, useSession } from "@/store";
import { CONTACT_SOURCES, type Contact } from "@/types";
import { CompanyPicker } from "./pickers";

const UNASSIGNED = "unassigned";

function emptyForm(contact: Contact | undefined, ownerId: string | undefined) {
  return {
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    jobTitle: contact?.jobTitle ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    linkedinUrl: contact?.linkedinUrl ?? "",
    country: contact?.country ?? "",
    location: contact?.location ?? "",
    source: contact?.source ?? "other",
    ownerId: contact ? (contact.ownerId ?? UNASSIGNED) : (ownerId ?? UNASSIGNED),
  };
}

function fieldFromDetails(details: unknown): string | null {
  const field = (details as { field?: unknown } | undefined)?.field;
  return typeof field === "string" ? field : null;
}

/** Add a contact (no `contact`, optionally at `defaultCompany`) or edit one. */
export function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  defaultCompany,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact;
  defaultCompany?: PickerOption | undefined;
}) {
  const { users, currentUser } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => emptyForm(contact, currentUser?.id));
  const [company, setCompany] = useState<PickerOption | null>(null);
  const [createDeal, setCreateDeal] = useState(false);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<{ field: string; message: string } | null>(null);

  // Reset to the contact (or a blank form) every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setForm(emptyForm(contact, currentUser?.id));
    setCompany(
      contact?.companyId
        ? { id: contact.companyId, label: contact.companyName ?? "" }
        : (defaultCompany ?? null),
    );
    setCreateDeal(false);
    setTouched(false);
    setServerError(null);
    // Keyed on the id: callers pass a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact, currentUser?.id, defaultCompany?.id]);

  const save = useCrmMutation((input: ContactInput) =>
    contact
      ? backend.contacts.update(contact.id, input)
      : backend.contacts.create({ ...input, createDeal }),
  );

  const errors = validateContact(form);
  const fieldError = (k: keyof ContactFormErrors) =>
    serverError?.field === k ? serverError.message : touched ? errors[k] : undefined;
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (serverError?.field === k) setServerError(null);
  };

  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    try {
      // Always send strings: "" clears a field on edit (undefined would keep the old value).
      const saved = await save.mutateAsync({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        jobTitle: form.jobTitle.trim(),
        email: normalizeEmail(form.email).value ?? form.email.trim(),
        phone: normalizePhone(form.phone).value ?? form.phone.trim(),
        linkedinUrl: form.linkedinUrl.trim(),
        country: form.country.trim(),
        location: form.location.trim(),
        // The brain's own source is kept as is on edit.
        source: form.source,
        companyId: company?.id ?? null,
        ownerId: form.ownerId === UNASSIGNED ? null : form.ownerId,
      });
      toast.success(contact ? "Contact updated" : "Contact created");
      onOpenChange(false);
      if (!contact) void navigate({ to: "/contacts/$contactId", params: { contactId: saved.id } });
    } catch (error) {
      // Nothing was saved, so the form stays open for a fix and retry.
      const field = error instanceof BackendError ? fieldFromDetails(error.details) : null;
      if (field) setServerError({ field, message: messageFromError(error) });
      else toast.error(messageFromError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>
            A contact needs a first name and at least an email, a phone number or a LinkedIn URL.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={fieldError("firstName")}>
            <Input
              value={form.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              aria-invalid={Boolean(fieldError("firstName"))}
            />
          </Field>
          <Field label="Last name">
            <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="Email" error={fieldError("email")}>
            <Input
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              onBlur={() => {
                const { value } = normalizeEmail(form.email);
                if (value) set("email", value);
              }}
              aria-invalid={Boolean(fieldError("email"))}
            />
          </Field>
          <Field label="Phone" error={fieldError("phone")}>
            <Input
              value={form.phone}
              placeholder="+91 …"
              onChange={(e) => set("phone", e.target.value)}
              onBlur={() => {
                const { value } = normalizePhone(form.phone);
                if (value) set("phone", value);
              }}
              aria-invalid={Boolean(fieldError("phone"))}
            />
          </Field>
          <Field label="LinkedIn URL" className="sm:col-span-2">
            <Input value={form.linkedinUrl} onChange={(e) => set("linkedinUrl", e.target.value)} />
          </Field>
          <Field label="Job title">
            <Input value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
          </Field>
          <Field label="Company">
            <CompanyPicker value={company} onChange={setCompany} />
          </Field>
          <Field label="Country">
            <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
          </Field>
          <Field label="Location">
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
          </Field>
          <Field label="Source">
            <Select
              value={form.source}
              onValueChange={(v) => set("source", v)}
              disabled={form.source === "brain"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...CONTACT_SOURCES, ...(form.source === "brain" ? ["brain"] : [])].map((s) => (
                  <SelectItem key={s} value={s}>
                    {label(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={form.ownerId} onValueChange={(v) => set("ownerId", v)}>
              <SelectTrigger>
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
          {!contact && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={createDeal} onCheckedChange={(v) => setCreateDeal(v === true)} />
              Also open a deal (qualified lead) for this contact
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={(touched && Object.keys(errors).length > 0) || save.isPending}
            onClick={() => void submit()}
          >
            {save.isPending ? "Saving…" : contact ? "Save" : "Create contact"}
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
