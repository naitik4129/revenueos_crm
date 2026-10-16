import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/app/app-shell";
import { useAddContact } from "@/app/add-contact-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterSelect, Pager, SearchBox } from "@/components/common/list-controls";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { useContacts, useSession } from "@/store";
import {
  CONTACT_STATUSES,
  LIFECYCLE_STAGES,
  type ContactStatus,
  type LifecycleStage,
} from "@/types";
import { CompanyLink } from "@/features/companies/company-link";
import { ImportContactsDialog } from "./import-contacts-dialog";

const PAGE_SIZE = 50;
const ALL = "all";

export function ContactsPage() {
  const { users } = useSession();
  const addContact = useAddContact();
  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [owner, setOwner] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  // Any filter change starts again at the first page.
  useEffect(() => setOffset(0), [search, lifecycle, status, owner]);

  const { data, isLoading, error, isFetching } = useContacts({
    search: search || undefined,
    lifecycleStage: lifecycle === ALL ? undefined : (lifecycle as LifecycleStage),
    status: status === ALL ? undefined : (status as ContactStatus),
    ownerId: owner === ALL ? undefined : owner,
    limit: PAGE_SIZE,
    offset,
  });
  const contacts = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="pb-10">
      <PageHeader
        title="Contacts"
        description="Every person in this workspace: brain prospects and your own contacts."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              Import from CSV
            </Button>
            <Button size="sm" onClick={addContact.open}>
              Add contact
            </Button>
          </>
        }
      />
      <ImportContactsDialog open={importOpen} onOpenChange={setImportOpen} />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox
            placeholder="Name, email, phone, company"
            label="Search contacts"
            onSearch={setSearch}
          />
          <FilterSelect
            label="Lifecycle stage"
            value={lifecycle}
            onChange={setLifecycle}
            options={[[ALL, "All stages"], ...LIFECYCLE_STAGES.map((s) => [s, label(s)] as const)]}
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              [ALL, "Active + DNC"],
              ...CONTACT_STATUSES.map((s) => [s, label(s)] as const),
            ]}
          />
          <FilterSelect
            label="Owner"
            value={owner}
            onChange={setOwner}
            options={[[ALL, "All owners"], ...users.map((u) => [u.id, u.name] as const)]}
          />
        </div>

        {isLoading ? (
          <LoadingBlock label="Loading contacts…" />
        ) : error ? (
          <ErrorBlock error={error} />
        ) : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {[
                      "Contact / Company",
                      "Lifecycle",
                      "Status",
                      "Open deal",
                      "Owner",
                      "Source",
                      "Last activity",
                    ].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className={isFetching ? "opacity-60" : undefined}>
                  {contacts.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-accent/40">
                      <td className="px-3 py-2">
                        <Link
                          to="/contacts/$contactId"
                          params={{ contactId: c.id }}
                          className="font-medium hover:underline"
                        >
                          {c.firstName} {c.lastName}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {c.jobTitle}
                          {c.jobTitle && c.companyName && " · "}
                          <CompanyLink id={c.companyId} name={c.companyName} />
                          {!c.jobTitle && !c.companyName && c.email}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge value={c.lifecycleStage} tone="neutral" />
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge value={c.status} />
                      </td>
                      <td className="px-3 py-2 text-xs">{c.openDealId ? "Yes" : "-"}</td>
                      <td className="px-3 py-2 text-xs">{c.ownerName ?? "Unassigned"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{label(c.source)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {relDay(c.lastActivityAt)}
                      </td>
                    </tr>
                  ))}
                  {contacts.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-10 text-center text-sm text-muted-foreground"
                      >
                        No contacts match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Pager offset={offset} pageSize={PAGE_SIZE} total={total} onOffset={setOffset} />
      </div>
    </div>
  );
}
