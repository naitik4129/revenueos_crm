import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { messageFromError, useLeads, useSession } from "@/store";
import { BackendError } from "@/lib/backend-client";
import {
  normalizeEmail,
  normalizePhone,
  validateLeadForm,
  type LeadFormErrors,
} from "@/lib/lead-validation";
import { LEAD_SOURCES, type LeadSource } from "@/types";
import { label } from "@/lib/labels";

const SERVICES = [
  "B2B Lead Generation",
  "Market Research",
  "Target Account Identification",
  "Account-Based Marketing (ABM)",
  "Cold Calling",
  "Email Outreach",
  "LinkedIn Outreach",
  "WhatsApp Outreach",
  "Lead Nurturing & Follow-Up",
  "Sales Conversion Support",
  "Industrial Marketing",
  "Digital Marketing",
  "SEO",
  "Website Optimization",
  "Market Expansion",
  "Business Development",
  "Field Marketing / Direct Visits",
  "End-to-End Sales & Marketing",
  "Other",
];

function fieldFromDetails(details: unknown): string | null {
  if (details && typeof details === "object" && "field" in details) {
    const field = (details as { field?: unknown }).field;
    return typeof field === "string" ? field : null;
  }
  return null;
}

export function AddLeadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { addLead, addNote, isPending } = useLeads();
  const { users, currentUser } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    company: "",
    industry: "",
    phone: "",
    email: "",
    source: "website" as LeadSource,
    serviceInterest: "B2B Lead Generation",
    ownerId: currentUser?.id ?? "",
    notes: "",
  });
  const [touched, setTouched] = useState<Partial<Record<keyof LeadFormErrors, boolean>>>({});
  const [backendFieldError, setBackendFieldError] = useState<{
    field: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (currentUser?.id && !form.ownerId)
      setForm((value) => ({ ...value, ownerId: currentUser.id }));
  }, [currentUser?.id, form.ownerId]);

  const errors = validateLeadForm(form);
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (backendFieldError?.field === k) setBackendFieldError(null);
  };
  const touch = (k: keyof LeadFormErrors) => setTouched((t) => ({ ...t, [k]: true }));
  const fieldError = (k: keyof LeadFormErrors) =>
    backendFieldError?.field === k ? backendFieldError.message : touched[k] ? errors[k] : undefined;

  const submit = async () => {
    if (Object.keys(errors).length > 0) {
      setTouched({ firstName: true, company: true, email: true, phone: true, source: true });
      return;
    }
    setBackendFieldError(null);

    let lead;
    try {
      lead = await addLead({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        company: form.company.trim(),
        industry: form.industry.trim(),
        phone: form.phone.trim() ? (normalizePhone(form.phone).value ?? form.phone.trim()) : "",
        email: form.email.trim() ? (normalizeEmail(form.email).value ?? form.email.trim()) : "",
        source: form.source,
        serviceInterest: form.serviceInterest,
        ownerId: form.ownerId,
      });
    } catch (error) {
      // Lead was never created — safe to leave the dialog open with the
      // form intact so the user can fix and retry without risk of a
      // duplicate.
      const field = error instanceof BackendError ? fieldFromDetails(error.details) : null;
      if (field) {
        setBackendFieldError({ field, message: messageFromError(error) });
      } else {
        toast.error(messageFromError(error));
      }
      return;
    }

    // The lead now exists server-side. Treat this as done regardless of
    // whether the optional note below succeeds — closing/resetting here
    // (rather than after the note call) is what prevents a retry from
    // re-submitting addLead and creating a duplicate.
    toast.success("Lead created");
    onOpenChange(false);
    setForm((f) => ({
      ...f,
      firstName: "",
      lastName: "",
      company: "",
      industry: "",
      phone: "",
      email: "",
      notes: "",
    }));
    setTouched({});
    void navigate({ to: "/leads/$leadId", params: { leadId: lead.id } });

    if (form.notes.trim()) {
      try {
        await addNote(lead.id, form.notes.trim());
      } catch (error) {
        toast.error(`Lead created, but the note failed to save: ${messageFromError(error)}`);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add lead</DialogTitle>
          <DialogDescription>
            New leads start in the New stage with a first call as the next action.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={fieldError("firstName")}>
            <Input
              value={form.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              onBlur={() => touch("firstName")}
              aria-invalid={Boolean(fieldError("firstName"))}
            />
          </Field>
          <Field label="Last name">
            <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="Company" className="sm:col-span-2" error={fieldError("company")}>
            <Input
              value={form.company}
              onChange={(e) => set("company", e.target.value)}
              onBlur={() => touch("company")}
              aria-invalid={Boolean(fieldError("company"))}
            />
          </Field>
          <Field label="Industry">
            <Input value={form.industry} onChange={(e) => set("industry", e.target.value)} />
          </Field>
          <Field label="Phone" error={fieldError("phone")}>
            <Input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              onBlur={() => {
                touch("phone");
                const { value } = normalizePhone(form.phone);
                if (value) setForm((f) => ({ ...f, phone: value }));
              }}
              placeholder="+91 …"
              aria-invalid={Boolean(fieldError("phone"))}
            />
          </Field>
          <Field label="Email" error={fieldError("email")}>
            <Input
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              onBlur={() => {
                touch("email");
                const { value } = normalizeEmail(form.email);
                if (value) setForm((f) => ({ ...f, email: value }));
              }}
              aria-invalid={Boolean(fieldError("email"))}
            />
          </Field>
          <Field label="Lead source">
            <Select value={form.source} onValueChange={(v) => set("source", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {label(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Service interest">
            <Select value={form.serviceInterest} onValueChange={(v) => set("serviceInterest", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
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
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={Object.keys(errors).length > 0 || isPending}
            onClick={() => void submit()}
          >
            {isPending ? "Creating…" : "Create lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  className,
  error,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  error?: string | undefined;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs">{label}</Label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
