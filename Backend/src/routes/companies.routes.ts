import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { pool, withTransaction } from "../db.js";
import { parseBody, parseId, parseQuery } from "../validation/parse.js";
import * as companies from "../services/companies.service.js";
import { sortValues } from "../dto.js";
import { listContacts } from "../services/contacts.service.js";
import { listDeals } from "../services/deals.service.js";
import { listTimeline } from "../services/timeline.service.js";

/** Mounted under the workspace-gated crmRouter (routes/index.ts). */
export const companiesRouter = Router();

const id = (req: { params: Record<string, string | undefined> }) => parseId(req.params.id, "Company");
const page = { limit: z.coerce.number().int().positive().max(500).optional(), offset: z.coerce.number().int().min(0).optional() };

const companyFields = {
  domain: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  headcount: z.number().int().min(0).nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  source: z.string().nullable().optional(),
};

companiesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({ search: z.string().optional(), ownerId: z.union([z.string().uuid(), z.literal("none")]).optional(), industry: z.string().optional(), sort: z.enum(sortValues(companies.COMPANY_SORTS)).optional(), ...page }),
      req.query,
    );
    res.json(await companies.listCompanies(pool, req.workspaceId!, q));
  }),
);

// Before "/:id" so "industries" is not read as an id.
companiesRouter.get(
  "/industries",
  asyncHandler(async (req, res) => {
    res.json({ data: await companies.listIndustries(pool, req.workspaceId!) });
  }),
);

companiesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ name: z.string(), ...companyFields }), req.body);
    const row = await withTransaction((db) => companies.createCompany(db, req.actor!, req.workspaceId!, input));
    res.status(201).json(companies.companyToDto(row));
  }),
);

companiesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(companies.companyToDto(await companies.getCompanyOr404(pool, req.workspaceId!, id(req))));
  }),
);

companiesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = parseBody(z.object({ name: z.string().optional(), ...companyFields }), req.body);
    const row = await withTransaction((db) => companies.updateCompany(db, req.actor!, req.workspaceId!, id(req), patch));
    res.json(companies.companyToDto(row));
  }),
);

companiesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await withTransaction((db) => companies.deleteCompany(db, req.actor!, req.workspaceId!, id(req)));
    res.status(204).send();
  }),
);

companiesRouter.get(
  "/:id/contacts",
  asyncHandler(async (req, res) => {
    const companyId = (await companies.getCompanyOr404(pool, req.workspaceId!, id(req))).id;
    res.json(await listContacts(pool, req.workspaceId!, { ...parseQuery(z.object(page), req.query), companyId }));
  }),
);

companiesRouter.get(
  "/:id/deals",
  asyncHandler(async (req, res) => {
    const companyId = (await companies.getCompanyOr404(pool, req.workspaceId!, id(req))).id;
    res.json(await listDeals(pool, req.workspaceId!, { ...parseQuery(z.object(page), req.query), companyId }));
  }),
);

companiesRouter.get(
  "/:id/timeline",
  asyncHandler(async (req, res) => {
    const companyId = (await companies.getCompanyOr404(pool, req.workspaceId!, id(req))).id;
    res.json({ data: await listTimeline(pool, req.workspaceId!, { ...parseQuery(z.object(page), req.query), companyId }) });
  }),
);
