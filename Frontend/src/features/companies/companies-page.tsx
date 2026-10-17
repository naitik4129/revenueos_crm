import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
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
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { backend } from "@/lib/backend-client";
import { downloadCsv } from "@/lib/csv";
import { fmtDate } from "@/lib/format";
import { label } from "@/lib/labels";
import { useBulkAssignOwner } from "@/lib/use-bulk-assign";
import { useStoredColumns } from "@/lib/use-stored-columns";
import { useCompanies, useIndustries, useSession } from "@/store";
import type { Company } from "@/types";
import { CompanyFormDialog } from "./company-form-dialog";
import { countLabel } from "@/lib/format";

const PAGE_SIZE = 50;
const ALL = "all";

type Filters = { industry: string; owner: string };
const NO_FILTERS: Filters = { industry: ALL, owner: ALL };

// Fixed views are filter presets; the tab is highlighted while the filters still match it.
const VIEWS: { id: string; label: string; filters: (me?: string) => Filters }[] = [
  { id: "all", label: "All companies", filters: () => NO_FILTERS },
  { id: "mine", label: "My companies", filters: (me) => ({ ...NO_FILTERS, owner: me ?? ALL }) },
];

const location = (c: Company) =>
  [c.location ?? c.city, c.country].filter(Boolean).join(", ") || undefined;

const COLUMNS: ListColumn<Company>[] = [
  { id: "domain", label: "Domain", cell: (c) => c.domain },
  { id: "industry", label: "Industry", cell: (c) => c.industry },
  { id: "location", label: "Location", cell: location },
  { id: "headcount", label: "Headcount", cell: (c) => c.headcount },
  { id: "contacts", label: "Contacts", cell: (c) => c.contactCount },
  { id: "openDeals", label: "Open deals", cell: (c) => c.openDealCount },
  {
    id: "owner",
    label: "Owner",
    cell: (c) => c.ownerName ?? <span className="text-muted-foreground">Unassigned</span>,
  },
  { id: "phone", label: "Phone", cell: (c) => c.phone },
  { id: "source", label: "Source", cell: (c) => c.source && label(c.source) },
  { id: "created", label: "Created", cell: (c) => fmtDate(c.createdAt) },
];
const DEFAULT_COLUMNS = ["domain", "industry", "location", "contacts", "openDeals", "owner"];

export function CompaniesPage() {
  const { users, currentUser } = useSession();
  const industries = useIndustries();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [visible, setVisible] = useStoredColumns("companies.columns", DEFAULT_COLUMNS);
  const assignOwner = useBulkAssignOwner(
    (id, ownerId) => backend.companies.update(id, { ownerId }),
    "company",
  );

  // Any filter change starts again at the first page.
  useEffect(() => setOffset(0), [search, filters]);
  // Selection is per page: changing page or filters clears it.
  useEffect(() => setSelected([]), [search, filters, offset]);

  const { data, isLoading, error, isFetching } = useCompanies({
    search: search || undefined,
    ownerId: filters.owner === ALL ? undefined : filters.owner,
    industry: filters.industry === ALL ? undefined : filters.industry,
    limit: PAGE_SIZE,
    offset,
  });
  const companies = data?.data ?? [];
  const total = data?.total ?? 0;

  const views = VIEWS.filter((v) => v.id !== "mine" || currentUser);
  const activeView =
    views.find((v) => JSON.stringify(v.filters(currentUser?.id)) === JSON.stringify(filters))?.id ??
    null;
  const filtered = Boolean(search) || activeView !== "all";
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const exportSelected = () =>
    downloadCsv("companies.csv", [
      [
        "Name",
        "Domain",
        "Website",
        "Industry",
        "Location",
        "Headcount",
        "Phone",
        "Contacts",
        "Open deals",
        "Owner",
        "Source",
        "Created",
      ],
      ...companies
        .filter((c) => selected.includes(c.id))
        .map((c) => [
          c.name,
          c.domain ?? "",
          c.website ?? "",
          c.industry ?? "",
          location(c) ?? "",
          c.headcount ?? "",
          c.phone ?? "",
          c.contactCount,
          c.openDealCount,
          c.ownerName ?? "",
          c.source ? label(c.source) : "",
          c.createdAt,
        ]),
    ]);

  return (
    <div className="pb-10">
      <PageHeader
        title="Companies"
        count={isLoading ? undefined : countLabel(total, "company", "companies")}
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Create company
          </Button>
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
      <CompanyFormDialog open={addOpen} onOpenChange={setAddOpen} />

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
                  placeholder="Search name, domain, industry"
                  label="Search companies"
                  onSearch={setSearch}
                />
                <FilterSelect
                  label="Industry"
                  value={filters.industry}
                  onChange={(v) => set({ industry: v })}
                  options={[[ALL, "All industries"], ...industries.map((i) => [i, i] as const)]}
                />
                <FilterSelect
                  label="Owner"
                  value={filters.owner}
                  onChange={(v) => set({ owner: v })}
                  options={[[ALL, "All owners"], ...users.map((u) => [u.id, u.name] as const)]}
                />
                <div className="ml-auto">
                  <ColumnChooser columns={COLUMNS} visible={visible} onChange={setVisible} />
                </div>
              </>
            )}
          </div>

          {isLoading ? (
            <LoadingBlock label="Loading companies…" />
          ) : error ? (
            <ErrorBlock error={error} />
          ) : companies.length === 0 ? (
            filtered ? (
              <ListEmptyState
                icon={Building2}
                title="No companies match these filters."
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
                icon={Building2}
                title="No companies yet"
                text="Companies arrive from the RevenueOS brain and from contact imports, or add one by hand."
              >
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  Create company
                </Button>
              </ListEmptyState>
            )
          ) : (
            <RecordTable
              rows={companies}
              columns={COLUMNS.filter((c) => visible.includes(c.id))}
              rowLabel={(c) => c.name}
              selected={selected}
              onSelect={setSelected}
              dimmed={isFetching}
              name={(c) => (
                <div className="flex items-center gap-2.5">
                  <Avatar name={c.name} square />
                  <Link
                    to="/companies/$companyId"
                    params={{ companyId: c.id }}
                    className="truncate font-medium hover:underline"
                  >
                    {c.name}
                  </Link>
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
