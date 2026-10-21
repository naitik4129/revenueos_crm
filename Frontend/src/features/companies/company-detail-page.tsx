import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Globe, Linkedin, Phone, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/common/status-badge";
import { InfoRow, TimelineList } from "@/components/common/detail-parts";
import {
  Avatar,
  BackLink,
  CopyValue,
  MenuItem,
  Panel,
  QuickAction,
} from "@/components/common/record-parts";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { fmtDateTime, isOverdue, relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { useCompanyDetail } from "@/store";
import { ContactFormDialog } from "@/features/contacts/contact-form-dialog";
import { CompanyFormDialog } from "./company-form-dialog";

const external = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);
// The right column lists this many contacts before "Show all".
const CONTACTS_SHOWN = 8;

export function CompanyDetailPage({ companyId }: { companyId: string }) {
  const detail = useCompanyDetail(companyId);
  const [dialog, setDialog] = useState<"edit" | "contact" | null>(null);
  const [allContacts, setAllContacts] = useState(false);

  const company = detail.company.data;
  if (detail.company.isLoading)
    return (
      <div className="px-6 py-4">
        <LoadingBlock label="Loading company…" />
      </div>
    );
  if (!company)
    return (
      <div className="px-6 py-4">
        <ErrorBlock error={detail.company.error ?? new Error("Company not found.")} />
      </div>
    );

  const contacts = detail.contacts.data?.data ?? [];
  const deals = detail.deals.data?.data ?? [];
  const tasks = detail.tasks.data ?? [];
  const site = company.website ?? company.domain;
  const where = [company.location ?? company.city, company.country].filter(Boolean).join(", ");
  const close = (open: boolean) => !open && setDialog(null);

  return (
    <div className="pb-10">
      <BackLink to="/companies">Companies</BackLink>

      <div className="grid items-start gap-4 px-6 py-4 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_18rem]">
        {/* Left: what this company is, quick actions, key properties. */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Avatar name={company.name} square className="size-12 text-base" />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-lg font-semibold leading-tight">{company.name}</h1>
                  {company.domain && (
                    <a
                      href={external(company.domain)}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sm text-primary hover:underline"
                    >
                      {company.domain}
                    </a>
                  )}
                  <p className="truncate text-xs text-muted-foreground">
                    {[company.industry, where].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-1">
                <QuickAction icon={UserPlus} label="Contact" onClick={() => setDialog("contact")} />
                <QuickAction
                  icon={Phone}
                  label="Call"
                  href={company.phone ? `tel:${company.phone}` : undefined}
                  disabledReason={company.phone ? undefined : "No phone number"}
                />
                <QuickAction
                  icon={Globe}
                  label="Website"
                  href={site ? external(site) : undefined}
                  disabledReason={site ? undefined : "No website"}
                />
                <QuickAction
                  icon={Linkedin}
                  label="LinkedIn"
                  href={company.linkedinUrl ? external(company.linkedinUrl) : undefined}
                  disabledReason={company.linkedinUrl ? undefined : "No LinkedIn page"}
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="mt-3 w-full gap-1">
                    Actions <ChevronDown className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 p-1">
                  <MenuItem onClick={() => setDialog("edit")}>Edit company</MenuItem>
                  <MenuItem onClick={() => setDialog("contact")}>Add a contact here</MenuItem>
                </PopoverContent>
              </Popover>
            </CardContent>
          </Card>

          <Panel title="About this company">
            <div className="space-y-2 text-sm">
              <InfoRow name="Domain" value={company.domain} />
              <InfoRow
                name="Website"
                value={
                  company.website && (
                    <a
                      href={external(company.website)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {company.website}
                    </a>
                  )
                }
              />
              <InfoRow name="Industry" value={company.industry} />
              <InfoRow name="Headcount" value={company.headcount?.toString()} />
              <InfoRow name="Location" value={where} />
              <InfoRow name="Phone" value={company.phone && <CopyValue value={company.phone} />} />
              <InfoRow name="Owner" value={company.ownerName ?? "Unassigned"} />
              <InfoRow name="Source" value={company.source && label(company.source)} />
              <InfoRow name="Created" value={fmtDateTime(company.createdAt)} />
            </div>
          </Panel>
        </div>

        {/* Middle: activity. */}
        <div className="min-w-0 space-y-3">
          <h2 className="text-sm font-semibold">Activity</h2>
          <TimelineList query={detail.timeline} />
        </div>

        {/* Right: associated records. */}
        <div className="space-y-4 lg:col-start-2 xl:col-start-auto">
          <Panel
            title={`Contacts (${company.contactCount})`}
            action={
              <Button size="sm" variant="ghost" onClick={() => setDialog("contact")}>
                Add
              </Button>
            }
          >
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contacts at this company yet.</p>
            ) : (
              <div className="space-y-2.5">
                {(allContacts ? contacts : contacts.slice(0, CONTACTS_SHOWN)).map((c) => {
                  const name = `${c.firstName} ${c.lastName}`.trim() || c.email || "(no name)";
                  return (
                    <div key={c.id} className="flex items-center gap-2.5 text-sm">
                      <Avatar name={name} />
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/contacts/$contactId"
                          params={{ contactId: c.id }}
                          className="block truncate font-medium hover:underline"
                        >
                          {name}
                        </Link>
                        {c.jobTitle && (
                          <div className="truncate text-xs text-muted-foreground">{c.jobTitle}</div>
                        )}
                      </div>
                      {c.status === "do_not_contact" ? (
                        <StatusBadge value="DNC" tone="danger" />
                      ) : (
                        <StatusBadge value={c.lifecycleStage} tone="neutral" />
                      )}
                    </div>
                  );
                })}
                {contacts.length > CONTACTS_SHOWN && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setAllContacts((v) => !v)}
                  >
                    {allContacts ? "Show fewer" : `Show all ${contacts.length}`}
                  </button>
                )}
              </div>
            )}
          </Panel>

          <Panel title={`Deals (${detail.deals.data?.total ?? 0})`}>
            {deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deals with this company yet.</p>
            ) : (
              <div className="space-y-2.5">
                {deals.map((deal) => (
                  <div key={deal.id} className="text-sm">
                    <Link
                      to="/deals/$dealId"
                      params={{ dealId: deal.id }}
                      className="font-medium hover:underline"
                    >
                      {deal.serviceInterest ?? deal.contactName ?? "Deal"}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge value={deal.stage} />
                      {deal.outcome !== "open" && <StatusBadge value={deal.outcome} />}
                    </div>
                    <div className="pt-0.5 text-xs text-muted-foreground">
                      {[deal.contactName, deal.ownerName ?? "Unassigned"]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Open tasks">
            {detail.tasks.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open tasks on this company's deals.
              </p>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div key={task.id} className="text-sm">
                    <div className="font-medium">{task.title}</div>
                    <div
                      className={cn(
                        "text-xs",
                        isOverdue(task.dueAt) ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {[task.contactName, label(task.type), `due ${relDay(task.dueAt)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {dialog === "edit" && <CompanyFormDialog open onOpenChange={close} company={company} />}
      <ContactFormDialog
        open={dialog === "contact"}
        onOpenChange={close}
        defaultCompany={{ id: company.id, label: company.name }}
      />
    </div>
  );
}
