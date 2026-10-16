import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/common/status-badge";
import { InfoRow, Section, TimelineList } from "@/components/common/detail-parts";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { fmtDateTime, relDay } from "@/lib/format";
import { useCompanyDetail } from "@/store";
import { CompanyFormDialog } from "./company-form-dialog";

const external = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

export function CompanyDetailPage({ companyId }: { companyId: string }) {
  const detail = useCompanyDetail(companyId);
  const [editOpen, setEditOpen] = useState(false);

  const company = detail.company.data;
  if (detail.company.isLoading)
    return (
      <div className="p-6">
        <LoadingBlock label="Loading company…" />
      </div>
    );
  if (!company)
    return (
      <div className="p-6">
        <ErrorBlock error={detail.company.error ?? new Error("Company not found.")} />
      </div>
    );

  return (
    <div className="pb-10">
      <PageHeader
        title={company.name}
        heading={
          <div>
            <Link to="/companies" className="text-xs text-muted-foreground hover:underline">
              Companies
            </Link>
            <h1 className="text-xl font-semibold tracking-tight">{company.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[company.domain, company.industry].filter(Boolean).join(" · ") || "No domain"}
            </p>
          </div>
        }
        actions={
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs defaultValue="contacts">
            <TabsList>
              <TabsTrigger value="contacts">Contacts ({company.contactCount})</TabsTrigger>
              <TabsTrigger value="deals">Deals ({detail.deals.data?.total ?? 0})</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>

            <TabsContent value="contacts" className="mt-4">
              <Section query={detail.contacts} empty="No contacts at this company yet.">
                {(data) =>
                  data.data.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center gap-2 border-b py-3 last:border-0"
                    >
                      <Link
                        to="/contacts/$contactId"
                        params={{ contactId: c.id }}
                        className="text-sm font-medium hover:underline"
                      >
                        {c.firstName} {c.lastName}
                      </Link>
                      {c.jobTitle && (
                        <span className="text-xs text-muted-foreground">{c.jobTitle}</span>
                      )}
                      <span className="ml-auto flex items-center gap-1.5">
                        <StatusBadge value={c.lifecycleStage} tone="neutral" />
                        {c.status !== "active" && <StatusBadge value={c.status} />}
                      </span>
                    </div>
                  ))
                }
              </Section>
            </TabsContent>

            <TabsContent value="deals" className="mt-4">
              <Section query={detail.deals} empty="No deals with this company yet.">
                {(data) =>
                  data.data.map((deal) => (
                    <div
                      key={deal.id}
                      className="flex flex-wrap items-center gap-2 border-b py-3 last:border-0"
                    >
                      <StatusBadge value={deal.outcome} />
                      <StatusBadge value={deal.stage} />
                      <Link
                        to="/contacts/$contactId"
                        params={{ contactId: deal.contactId }}
                        className="text-sm hover:underline"
                      >
                        {deal.contactName}
                      </Link>
                      {deal.serviceInterest && (
                        <span className="text-xs text-muted-foreground">
                          · {deal.serviceInterest}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {deal.ownerName ?? "Unassigned"} · {relDay(deal.lastActivityAt)}
                      </span>
                      <Link
                        to="/deals/$dealId"
                        params={{ dealId: deal.id }}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Open deal
                      </Link>
                    </div>
                  ))
                }
              </Section>
            </TabsContent>

            <TabsContent value="timeline" className="mt-4">
              <TimelineList query={detail.timeline} />
            </TabsContent>
          </Tabs>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Company</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
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
            <InfoRow
              name="Location"
              value={[company.location ?? company.city, company.country].filter(Boolean).join(", ")}
            />
            <InfoRow name="Phone" value={company.phone} />
            <InfoRow
              name="LinkedIn"
              value={
                company.linkedinUrl && (
                  <a
                    href={external(company.linkedinUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    Page
                  </a>
                )
              }
            />
            <InfoRow name="Owner" value={company.ownerName ?? "Unassigned"} />
            <InfoRow name="Source" value={company.source} />
            <InfoRow name="Open deals" value={company.openDealCount.toString()} />
            <InfoRow name="Added" value={fmtDateTime(company.createdAt)} />
          </CardContent>
        </Card>
      </div>

      {editOpen && <CompanyFormDialog open onOpenChange={setEditOpen} company={company} />}
    </div>
  );
}
