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
import { LEAD_SOURCES, type LeadSource } from "@/types";
import { label } from "@/lib/labels";

const INDUSTRIES = [
  "Healthcare",
  "Fintech",
  "Manufacturing",
  "SaaS",
  "Retail",
  "Logistics",
  "Education",
  "Energy",
  "Insurance",
  "Real Estate",
  "Other",
];

const SERVICES = ["Sales Automation", "CRM Implementation", "Lead Nurturing", "Consulting"];

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
    phone: "",
    email: "",
    source: "website" as LeadSource,
    industry: "SaaS",
    serviceInterest: "Sales Automation",
    ownerId: currentUser?.id ?? "",
    notes: "",
  });

  useEffect(() => {
    if (currentUser?.id && !form.ownerId)
      setForm((value) => ({ ...value, ownerId: currentUser.id }));
  }, [currentUser?.id, form.ownerId]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid =
    form.firstName.trim() && form.company.trim() && (form.email.trim() || form.phone.trim());

  const submit = async () => {
    let lead;
    try {
      lead = await addLead({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        company: form.company.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        source: form.source,
        industry: form.industry,
        serviceInterest: form.serviceInterest,
        ownerId: form.ownerId,
      });
    } catch (error) {
      // Lead was never created — safe to leave the dialog open with the
      // form intact so the user can fix and retry without risk of a
      // duplicate.
      toast.error(messageFromError(error));
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
      phone: "",
      email: "",
      notes: "",
    }));
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
          <Field label="First name">
            <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="Company" className="sm:col-span-2">
            <Input value={form.company} onChange={(e) => set("company", e.target.value)} />
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
          <Field label="Industry">
            <Select value={form.industry} onValueChange={(v) => set("industry", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
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
          <Button disabled={!valid || isPending} onClick={() => void submit()}>
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
