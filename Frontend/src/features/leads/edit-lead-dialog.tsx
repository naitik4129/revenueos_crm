import { useState } from "react";
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
import { messageFromError, useLeads, useSession } from "@/store";
import { LEAD_SOURCES, type Lead, type LeadSource } from "@/types";
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

type FormState = {
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  industry: string;
  phone: string;
  email: string;
  source: LeadSource;
  serviceInterest: string;
  ownerId: string;
};

function formFromLead(lead: Lead): FormState {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    company: lead.company,
    jobTitle: lead.jobTitle ?? "",
    industry: lead.industry ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    source: lead.source,
    serviceInterest: lead.serviceInterest || "B2B Lead Generation",
    ownerId: lead.ownerId ?? "",
  };
}

export function EditLeadDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: Lead;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { updateLead, isPending } = useLeads();
  const { users } = useSession();
  const [form, setForm] = useState<FormState>(() => formFromLead(lead));
  const [loadedFor, setLoadedFor] = useState(lead.id);

  // The dialog stays mounted (only `open` toggles), so the useState
  // initializer only runs once — re-sync whenever it's opened for a
  // different lead than what's currently loaded, same pattern as
  // NextActionDialog in lead-detail-page.tsx.
  if (open && loadedFor !== lead.id) {
    setLoadedFor(lead.id);
    setForm(formFromLead(lead));
  }

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid =
    form.firstName.trim() && form.company.trim() && (form.email.trim() || form.phone.trim());

  const submit = async () => {
    try {
      await updateLead(lead.id, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        company: form.company.trim(),
        jobTitle: form.jobTitle.trim(),
        industry: form.industry.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        source: form.source,
        serviceInterest: form.serviceInterest,
        ownerId: form.ownerId || undefined,
      });
    } catch (error) {
      toast.error(messageFromError(error));
      return;
    }
    toast.success("Lead updated");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit lead</DialogTitle>
          <DialogDescription>Update this lead's contact and company details.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="Company" className="sm:col-span-2">
            <Input value={form.company} onChange={(e) => set("company", e.target.value)} />
          </Field>
          <Field label="Job title">
            <Input value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
          </Field>
          <Field label="Industry">
            <Input value={form.industry} onChange={(e) => set("industry", e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+91 …"
            />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
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
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || isPending} onClick={() => void submit()}>
            {isPending ? "Saving…" : "Save changes"}
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
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs">{label}</Label>
      {children}
    </div>
  );
}
