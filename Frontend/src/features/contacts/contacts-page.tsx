import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { useAddContact } from "@/app/add-contact-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  RelTime,
  BulkBar,
  ColumnChooser,
  FilterSelect,
  ListEmptyState,
  Pager,
  RecordTable,
  SearchBox,
  ViewTabs,
  type ListColumn,
} from "@/components/common/list-controls";
import { Avatar } from "@/components/common/record-parts";
import { StatusBadge } from "@/components/common/status-badge";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { backend } from "@/lib/backend-client";
import { downloadCsv } from "@/lib/csv";
import { fmtDate } from "@/lib/format";
import { label } from "@/lib/labels";
import { useBulkAssignOwner } from "@/lib/use-bulk-assign";
import { useStoredColumns } from "@/lib/use-stored-columns";
import { useContacts, useSession } from "@/store";
import {
  CONTACT_STATUSES,
  LIFECYCLE_STAGES,
  type Contact,
  type ContactStatus,
  type LifecycleStage,
} from "@/types";
import { CompanyLink } from "@/features/companies/company-link";
import { ImportContactsDialog } from "./import-contacts-dialog";
import { countLabel } from "@/lib/format";

const PAGE_SIZE = 50;
const ALL = "all";
// The API reads ownerId=none as "no owner".
const UNASSIGNED = "none";

type Filters = { lifecycle: string; status: string; owner: string };
const NO_FILTERS: Filters = { lifecycle: ALL, status: ALL, owner: ALL };

// Fixed views are filter presets; the tab is highlighted while the filters still match it.
const VIEWS: { id: string; label: string; filters: (me?: string) => Filters }[] = [
  { id: "all", label: "All contacts", filters: () => NO_FILTERS },
  { id: "mine", label: "My contacts", filters: (me) => ({ ...NO_FILTERS, owner: me ?? ALL }) },
  { id: "unassigned", label: "Unassigned", filters: () => ({ ...NO_FILTERS, owner: UNASSIGNED }) },
  {
    id: "qualified",
    label: "Qualified",
    filters: () => ({ ...NO_FILTERS, lifecycle: "qualified" }),
  },
  { id: "customer", label: "Customers", filters: () => ({ ...NO_FILTERS, lifecycle: "customer" }) },
  {
    id: "dnc",
    label: "Do not contact",
    filters: () => ({ ...NO_FILTERS, status: "do_not_contact" }),
  },
];

const COLUMNS: ListColumn<Contact>[] = [
  { id: "email", label: "Email", cell: (c) => c.email },
  { id: "phone", label: "Phone", cell: (c) => c.phone },
  {
    id: "company",
    label: "Company",
    cell: (c) => c.companyId && <CompanyLink id={c.companyId} name={c.companyName} />,
  },
  {
    id: "lifecycle",
    label: "Lifecycle",
    cell: (c) => <StatusBadge value={c.lifecycleStage} tone="neutral" />,
  },
  { id: "status", label: "Status", cell: (c) => <StatusBadge value={c.status} /> },
  {
    id: "owner",
    label: "Owner",
    cell: (c) => c.ownerName ?? <span className="text-muted-foreground">Unassigned</span>,
  },
  {
    id: "openDeal",
    label: "Open deal",
    cell: (c) =>
      c.openDealId && (
        <Link
          to="/deals/$dealId"
          params={{ dealId: c.openDealId }}
          className="text-primary hover:underline"
        >
          Open
        </Link>
      ),
  },
  { id: "lastActivity", label: "Last activity", cell: (c) => <RelTime iso={c.lastActivityAt} /> },
  { id: "source", label: "Source", cell: (c) => label(c.source) },
  { id: "created", label: "Created", cell: (c) => fmtDate(c.createdAt) },
];
const DEFAULT_COLUMNS = [
  "email",
  "phone",
  "company",
  "lifecycle",
  "owner",
  "openDeal",
  "lastActivity",
];

const contactName = (c: Contact) => `${c.firstName} ${c.lastName}`.trim() || c.email || "(no name)";

export function ContactsPage({ initialView }: { initialView?: string | undefined } = {}) {
  const { users, currentUser } = useSession();
  const addContact = useAddContact();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(() =>
    LIFECYCLE_STAGES.includes(initialView as LifecycleStage)
      ? { ...NO_FILTERS, lifecycle: initialView! }
      : (VIEWS.find((v) => v.id === initialView)?.filters(currentUser?.id) ?? NO_FILTERS),
  );
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [visible, setVisible] = useStoredColumns("contacts.columns", DEFAULT_COLUMNS);
  const assignOwner = useBulkAssignOwner(
    (id, ownerId) => backend.contacts.update(id, { ownerId }),
    "contact",
  );

  // Any filter change starts again at the first page.
  useEffect(() => setOffset(0), [search, filters]);
  // Selection is per page: changing page or filters clears it.
  useEffect(() => setSelected([]), [search, filters, offset]);

  const { data, isLoading, error, isFetching } = useContacts({
    search: search || undefined,
    lifecycleStage: filters.lifecycle === ALL ? undefined : (filters.lifecycle as LifecycleStage),
    status: filters.status === ALL ? undefined : (filters.status as ContactStatus),
    ownerId: filters.owner === ALL ? undefined : filters.owner,
    limit: PAGE_SIZE,
    offset,
  });
  const contacts = data?.data ?? [];
  const total = data?.total ?? 0;

  const views = VIEWS.filter((v) => v.id !== "mine" || currentUser);
  const activeView =
    views.find((v) => JSON.stringify(v.filters(currentUser?.id)) === JSON.stringify(filters))?.id ??
    null;
  const filtered = Boolean(search) || activeView !== "all";
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const exportSelected = () =>
    downloadCsv("contacts.csv", [
      [
        "First name",
        "Last name",
        "Email",
        "Phone",
        "Job title",
        "Company",
        "Lifecycle",
        "Status",
        "Owner",
        "Source",
        "Last activity",
        "Created",
      ],
      ...contacts
        .filter((c) => selected.includes(c.id))
        .map((c) => [
          c.firstName,
          c.lastName,
          c.email ?? "",
          c.phone ?? "",
          c.jobTitle ?? "",
          c.companyName ?? "",
          label(c.lifecycleStage),
          label(c.status),
          c.ownerName ?? "",
          label(c.source),
          c.lastActivityAt,
          c.createdAt,
        ]),
    ]);

  return (
    <div className="pb-10">
      <PageHeader
        title="Contacts"
        count={isLoading ? undefined : countLabel(total, "contact")}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              Import
            </Button>
            <Button size="sm" onClick={addContact.open}>
              Create contact
            </Button>
          </>
        }
        tabs={
          <ViewTabs
            views={views}
            active={activeView}
            onSelect={(id) =>
              setFilters(views.find((v) => v.id === id)?.filters(currentUser?.id) ?? NO_FILTERS)
            }
          />
        }
      />
      <ImportContactsDialog open={importOpen} onOpenChange={setImportOpen} />

      <div className="px-6 py-4">
        <Card className="overflow-hidden p-0">
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
            {selected.length > 0 ? (
              <BulkBar
                count={selected.length}
                users={users}
                assigning={assignOwner.isPending}
                onAssign={(ownerId) => assignOwner.assign(selected, ownerId, () => setSelected([]))}
                onExport={exportSelected}
                onClear={() => setSelected([])}
              />
            ) : (
              <>
                <SearchBox
                  placeholder="Search name, email, phone, company"
                  label="Search contacts"
                  onSearch={setSearch}
                />
                <FilterSelect
                  label="Lifecycle stage"
                  value={filters.lifecycle}
                  onChange={(v) => set({ lifecycle: v })}
                  options={[
                    [ALL, "All stages"],
                    ...LIFECYCLE_STAGES.map((s) => [s, label(s)] as const),
                  ]}
                />
                <FilterSelect
                  label="Owner"
                  value={filters.owner}
                  onChange={(v) => set({ owner: v })}
                  options={[
                    [ALL, "All owners"],
                    [UNASSIGNED, "Unassigned"],
                    ...users.map((u) => [u.id, u.name] as const),
                  ]}
                />
                <FilterSelect
                  label="Status"
                  value={filters.status}
                  onChange={(v) => set({ status: v })}
                  options={[
                    [ALL, "Active + DNC"],
                    ...CONTACT_STATUSES.map((s) => [s, label(s)] as const),
                  ]}
                />
                <div className="ml-auto">
                  <ColumnChooser columns={COLUMNS} visible={visible} onChange={setVisible} />
                </div>
              </>
            )}
          </div>

          {isLoading ? (
            <LoadingBlock label="Loading contacts…" />
          ) : error ? (
            <ErrorBlock error={error} />
          ) : contacts.length === 0 ? (
            filtered ? (
              <ListEmptyState
                icon={Users}
                title="No contacts match these filters."
                text="Try another view, change the search, or clear the filters."
              >
                {activeView !== "all" && (
                  <Button size="sm" variant="outline" onClick={() => setFilters(NO_FILTERS)}>
                    Clear filters
                  </Button>
                )}
              </ListEmptyState>
            ) : (
              <ListEmptyState
                icon={Users}
                title="No contacts yet"
                text="Contacts arrive from the RevenueOS brain, or add your own one by one or from a CSV."
              >
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                  Import
                </Button>
                <Button size="sm" onClick={addContact.open}>
                  Create contact
                </Button>
              </ListEmptyState>
            )
          ) : (
            <RecordTable
              rows={contacts}
              columns={COLUMNS.filter((c) => visible.includes(c.id))}
              rowLabel={contactName}
              selected={selected}
              onSelect={setSelected}
              dimmed={isFetching}
              name={(c) => (
                <div className="flex items-center gap-2.5">
                  <Avatar name={contactName(c)} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Link
                        to="/contacts/$contactId"
                        params={{ contactId: c.id }}
                        className="truncate font-medium hover:underline"
                      >
                        {contactName(c)}
                      </Link>
                      {c.doNotContact && <StatusBadge value="DNC" tone="danger" />}
                    </div>
                    {c.jobTitle && (
                      <div className="truncate text-xs text-muted-foreground">{c.jobTitle}</div>
                    )}
                  </div>
                </div>
              )}
            />
          )}

          {total > 0 && (
            <div className="border-t px-3 py-2">
              <Pager offset={offset} pageSize={PAGE_SIZE} total={total} onOffset={setOffset} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
