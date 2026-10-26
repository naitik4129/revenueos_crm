import type { Queryable } from "../dto.js";
import { NotFoundError } from "../errors.js";
import { previewTemplate, type RenderableTemplate } from "../domain/templateRenderer.js";
import { dealRenderContext, getDealOr404 } from "./deals.service.js";
import { getLatestMeetingForDeal, toRenderMeeting } from "./meetings.service.js";

export interface PreviewTarget {
  dealId?: string;
  contactId?: string;
}

/**
 * Renders unsaved template text for the editor preview. A contact previews as its open deal when
 * it has one (real sends always go through a deal); otherwise deal.* stay unfilled. meeting.*
 * use the deal's latest meeting, else stay unfilled.
 */
export async function previewTemplateFor(db: Queryable, workspaceId: string, template: RenderableTemplate, target: PreviewTarget) {
  let dealId = target.dealId ?? null;
  if (!dealId && target.contactId) {
    const contact = await db.query<{ open_deal_id: string | null }>(
      `select (select d.id from crm_deals d where d.contact_id = c.id and d.outcome = 'open') as open_deal_id
         from crm_contacts c where c.id = $1 and c.workspace_id = $2`,
      [target.contactId, workspaceId],
    );
    if (!contact.rows[0]) throw new NotFoundError("Contact");
    dealId = contact.rows[0].open_deal_id;
  }

  if (dealId) {
    const deal = await getDealOr404(db, workspaceId, dealId);
    const meeting = await getLatestMeetingForDeal(db, dealId);
    return {
      ...previewTemplate(template, dealRenderContext(deal), meeting ? toRenderMeeting(meeting) : null),
      dealId,
      meeting: meeting ? { title: meeting.title, at: meeting.scheduled_at.toISOString() } : null,
    };
  }

  const row = (
    await db.query<{
      first_name: string;
      last_name: string;
      email: string | null;
      phone: string | null;
      job_title: string | null;
      company_name: string | null;
      industry: string | null;
      website: string | null;
    }>(
      `select c.first_name, c.last_name, c.email, c.phone, c.job_title, co.name as company_name, co.industry, co.website
         from crm_contacts c left join crm_companies co on co.id = c.company_id
        where c.id = $1 and c.workspace_id = $2`,
      [target.contactId, workspaceId],
    )
  ).rows[0]!;
  const ctx = {
    contact: { firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, jobTitle: row.job_title },
    company: { name: row.company_name, industry: row.industry, website: row.website },
    deal: null,
  };
  return { ...previewTemplate(template, ctx, null), dealId: null, meeting: null };
}
