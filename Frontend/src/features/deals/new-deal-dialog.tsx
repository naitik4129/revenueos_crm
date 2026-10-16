import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
import type { PickerOption } from "@/components/common/search-picker";
import { backend, BackendError } from "@/lib/backend-client";
import { useCrmMutation } from "@/store";
import { ErrorNotice } from "@/features/contacts/contact-dialogs";
import { ContactPicker } from "@/features/contacts/pickers";

/** The open deal named in a 409 "This contact already has an open deal". */
function existingDealId(error: unknown) {
  const details =
    error instanceof BackendError ? (error.details as { dealId?: unknown } | undefined) : undefined;
  return typeof details?.dealId === "string" ? details.dealId : null;
}

/** Opens a deal for a contact. Mounted only while open, so it starts empty each time. */
export function NewDealDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [contact, setContact] = useState<PickerOption | null>(null);
  const [serviceInterest, setServiceInterest] = useState("");
  const create = useCrmMutation((contactId: string) =>
    backend.deals.create({
      contactId,
      ...(serviceInterest.trim() ? { serviceInterest: serviceInterest.trim() } : {}),
    }),
  );
  const openDealId = existingDealId(create.error);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New deal</DialogTitle>
          <DialogDescription>
            A contact can have one open deal at a time. The deal starts in New with a first call as
            its next action, and the contact becomes Qualified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block text-xs">Contact</Label>
            <ContactPicker
              value={contact}
              onChange={(option) => {
                setContact(option);
                create.reset();
              }}
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Service interest (optional)</Label>
            <Input value={serviceInterest} onChange={(e) => setServiceInterest(e.target.value)} />
          </div>
          <ErrorNotice error={create.error} />
          {openDealId && (
            <Link
              to="/deals/$dealId"
              params={{ dealId: openDealId }}
              className="block text-sm font-medium text-primary hover:underline"
            >
              Open the existing deal
            </Link>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!contact || create.isPending}
            onClick={() =>
              contact &&
              create.mutate(contact.id, {
                onSuccess: (deal) => {
                  toast.success(`Deal opened for ${deal.contactName}`);
                  onOpenChange(false);
                  void navigate({ to: "/deals/$dealId", params: { dealId: deal.id } });
                },
              })
            }
          >
            {create.isPending ? "Creating…" : "Create deal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
