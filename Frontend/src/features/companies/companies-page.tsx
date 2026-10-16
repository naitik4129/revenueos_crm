import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterSelect, Pager, SearchBox } from "@/components/common/list-controls";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { useCompanies, useIndustries, useSession } from "@/store";
import { CompanyFormDialog } from "./company-form-dialog";

const PAGE_SIZE = 50;
const ALL = "all";

export function CompaniesPage() {
  const { users } = useSession();
  const industries = useIndustries();
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState(ALL);
  const [industry, setIndustry] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const [addOpen, setAddOpen] = useState(false);

  // Any filter change starts again at the first page.
  useEffect(() => setOffset(0), [search, owner, industry]);

  const { data, isLoading, error, isFetching } = useCompanies({
    search: search || undefined,
    ownerId: owner === ALL ? undefined : owner,
    industry: industry === ALL ? undefined : industry,
    limit: PAGE_SIZE,
    offset,
  });
  const companies = data?.data ?? [];

  return (
    <div className="pb-10">
      <PageHeader
        title="Companies"
        description="Organisations in this workspace, from the brain and your team."
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Add company
          </Button>
        }
      />
      <CompanyFormDialog open={addOpen} onOpenChange={setAddOpen} />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox
            placeholder="Name, domain, industry"
            label="Search companies"
            onSearch={setSearch}
          />
          <FilterSelect
            label="Industry"
            value={industry}
            onChange={setIndustry}
            options={[[ALL, "All industries"], ...industries.map((i) => [i, i] as const)]}
          />
          <FilterSelect
            label="Owner"
            value={owner}
            onChange={setOwner}
            options={[[ALL, "All owners"], ...users.map((u) => [u.id, u.name] as const)]}
          />
        </div>

        {isLoading ? (
          <LoadingBlock label="Loading companies…" />
        ) : error ? (
          <ErrorBlock error={error} />
        ) : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {[
                      "Company",
                      "Industry",
                      "Location",
                      "Headcount",
                      "Contacts",
                      "Open deals",
                      "Owner",
                    ].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className={isFetching ? "opacity-60" : undefined}>
                  {companies.map((co) => (
                    <tr key={co.id} className="border-t hover:bg-accent/40">
                      <td className="px-3 py-2">
                        <Link
                          to="/companies/$companyId"
                          params={{ companyId: co.id }}
                          className="font-medium hover:underline"
                        >
                          {co.name}
                        </Link>
                        {co.domain && (
                          <span className="block text-xs text-muted-foreground">{co.domain}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{co.industry ?? "-"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {[co.location ?? co.city, co.country].filter(Boolean).join(", ") || "-"}
                      </td>
                      <td className="num px-3 py-2 text-xs">{co.headcount ?? "-"}</td>
                      <td className="num px-3 py-2 text-xs">{co.contactCount}</td>
                      <td className="num px-3 py-2 text-xs">{co.openDealCount}</td>
                      <td className="px-3 py-2 text-xs">{co.ownerName ?? "Unassigned"}</td>
                    </tr>
                  ))}
                  {companies.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-10 text-center text-sm text-muted-foreground"
                      >
                        No companies match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Pager offset={offset} pageSize={PAGE_SIZE} total={data?.total ?? 0} onOffset={setOffset} />
      </div>
    </div>
  );
}
