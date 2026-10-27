import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { type AuthContext, registerTool } from "./auth.js";
import {
  addCompany,
  addCompanyToSector,
  createSector,
  deleteSector,
  facets,
  getCompany,
  getSector,
  importCsv,
  listCompanies,
  listImports,
  listSectors,
  removeCompany,
  restoreCompany,
  updateCompany,
  updateSector,
} from "../domain/index.js";

import { fail, ok, text, wrap } from "./result.js";

export { fail, ok, text, wrap };

export const sectorId = z.string().describe("Sector UUID");
export const companyId = z.string().describe("Company UUID");
export const runId = z.string().describe("Run UUID");

const employeeBand = z.enum(["1-10", "11-50", "51-200", "201-500", "501+"]);
const companySort = z.enum(["name", "employees", "founded", "revenue"]);
const sortOrder = z.enum(["asc", "desc"]);

export function registerTools(server: McpServer, db: Db, auth: AuthContext): void {
  registerTool(server, db, auth, 
    "sector_create",
    {
      description: "Create a sector, optionally importing Apollo CSV files. Returns the sector with per-file import results.",
      inputSchema: {
        name: z.string().describe("Sector name (unique, case-insensitive)"),
        description: z.string().optional().describe("Sector description"),
        csvPaths: z
          .array(z.string())
          .optional()
          .describe("Absolute CSV paths to import (must sit inside KARDATA_IMPORT_DIRS)"),
        profile: z
          .unknown()
          .optional()
          .describe("Sector profile JSON (categories, scope, classifierHints); an included rubric is stored via the sector_rules_set validation; required before preflight"),
      },
    },
    async ({ name, description, csvPaths, profile }) =>
      wrap(async () => {
        const { sector, imports } = await createSector(db, { name, description, csvPaths, profile });
        const done = imports.filter((r) => r.ok).length;
        const failed = imports.length - done;
        const files = imports.length > 0 ? `, ${done} file(s) ok, ${failed} failed` : "";
        return {
          summary: `created sector "${sector.name}" (${sector.companyCount} companies${files})`,
          data: { sector, imports },
        };
      }),
  );

  registerTool(server, db, auth, 
    "sector_update",
    {
      description: "Rename a sector and/or change its description. Returns the updated sector.",
      inputSchema: {
        sectorId,
        name: z.string().optional().describe("New name (unique, case-insensitive)"),
        description: z.string().optional().describe("New description"),
      },
    },
    async ({ sectorId, name, description }) =>
      wrap(async () => {
        const sector = await updateSector(db, sectorId, { name, description });
        return { summary: `updated sector "${sector.name}"`, data: { sector } };
      }),
  );

  registerTool(server, db, auth, 
    "sector_delete",
    {
      description: "Delete a sector with its memberships and imports (global companies stay). Returns the deleted sector id and name.",
      inputSchema: {
        sectorId,
        confirmName: z.string().describe("Must equal the sector's name"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ sectorId, confirmName }) =>
      wrap(async () => {
        const deleted = await deleteSector(db, sectorId, confirmName);
        return { summary: `deleted sector "${deleted.name}"`, data: { sector: deleted } };
      }),
  );

  registerTool(server, db, auth, 
    "sector_list",
    {
      description: "List all sectors with live and removed company counts. Returns the sectors.",
      inputSchema: {},
    },
    async () =>
      wrap(async () => {
        const sectors = await listSectors(db);
        return { summary: `${sectors.length} sector(s)`, data: { sectors } };
      }),
  );

  registerTool(server, db, auth, 
    "sector_get",
    {
      description: "Get one sector with counts and its last 20 imports. Returns the sector.",
      inputSchema: { sectorId },
    },
    async ({ sectorId }) =>
      wrap(async () => {
        const sector = await getSector(db, sectorId);
        return {
          summary: `sector "${sector.name}" (${sector.companyCount} companies)`,
          data: { sector },
        };
      }),
  );

  registerTool(server, db, auth, 
    "companies_import_csv",
    {
      description: "Import Apollo CSV files into a sector. Returns per-file counts.",
      inputSchema: {
        sectorId,
        paths: z.array(z.string()).describe("Absolute CSV paths (inside KARDATA_IMPORT_DIRS)"),
      },
    },
    async ({ sectorId, paths }) =>
      wrap(async () => {
        const imports = await importCsv(db, sectorId, paths);
        const summary = imports
          .map((r) =>
            r.ok
              ? `${r.import.filename}: ${r.import.createdCount} created, ${r.import.linkedCount} linked, ${r.import.updatedCount} updated, ${r.import.skippedCount} skipped`
              : `${r.path}: FAILED (${r.error.message})`,
          )
          .join("; ");
        return { summary, data: { imports } };
      }),
  );

  registerTool(server, db, auth, 
    "company_add",
    {
      description: "Add a company by hand to a sector. Returns the company and possible domain duplicates.",
      inputSchema: {
        sectorId,
        name: z.string().describe("Company name"),
        domain: z.string().optional().describe("Domain (else derived from website)"),
        website: z.string().optional(),
        linkedinUrl: z.string().optional(),
        facebookUrl: z.string().optional(),
        twitterUrl: z.string().optional(),
        employees: z.number().int().optional(),
        industry: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        technologies: z.array(z.string()).optional(),
        country: z.string().optional(),
        state: z.string().optional(),
        city: z.string().optional(),
        postalCode: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        annualRevenue: z.union([z.string(), z.number()]).optional(),
        totalFunding: z.union([z.string(), z.number()]).optional(),
        latestFunding: z.string().optional(),
        latestFundingAmount: z.union([z.string(), z.number()]).optional(),
        lastRaisedAt: z.string().optional().describe("YYYY-MM-DD"),
        foundedYear: z.number().int().optional(),
        shortDescription: z.string().optional(),
        logoUrl: z.string().optional(),
        sicCodes: z.array(z.string()).optional(),
        naicsCodes: z.array(z.string()).optional(),
        notes: z.string().optional(),
      },
    },
    async ({ sectorId, ...input }) =>
      wrap(async () => {
        const { company, possibleDuplicates } = await addCompany(db, sectorId, input);
        const dupes =
          possibleDuplicates.length > 0
            ? ` (${possibleDuplicates.length} possible duplicate(s))`
            : "";
        return {
          summary: `added company "${company.name ?? company.id}"${dupes}`,
          data: { company, possibleDuplicates },
        };
      }),
  );

  registerTool(server, db, auth, 
    "company_link",
    {
      description: "Link an existing global company to another sector. Returns the link.",
      inputSchema: { sectorId, companyId },
    },
    async ({ sectorId, companyId }) =>
      wrap(async () => {
        const link = await addCompanyToSector(db, sectorId, companyId);
        return {
          summary: link.revived ? "revived the sector link" : "linked the company to the sector",
          data: { link },
        };
      }),
  );

  registerTool(server, db, auth, 
    "company_update",
    {
      description: "Edit a company via overrides (null clears one) and notes. Returns the company.",
      inputSchema: {
        companyId,
        patch: z
          .record(z.string(), z.unknown())
          .describe("Typed-field overrides plus notes; null clears an override"),
      },
    },
    async ({ companyId, patch }) =>
      wrap(async () => {
        const company = await updateCompany(db, companyId, patch);
        return { summary: `updated company "${company.name ?? company.id}"`, data: { company } };
      }),
  );

  registerTool(server, db, auth, 
    "company_remove",
    {
      description: "Remove a company from a sector (tombstone; re-imports will not revive it). Returns the removal.",
      inputSchema: { sectorId, companyId },
      annotations: { destructiveHint: true },
    },
    async ({ sectorId, companyId }) =>
      wrap(async () => {
        const removed = await removeCompany(db, sectorId, companyId);
        return { summary: "removed the company from the sector", data: { removed } };
      }),
  );

  registerTool(server, db, auth, 
    "company_restore",
    {
      description: "Restore a removed company to its sector. Returns the restoration.",
      inputSchema: { sectorId, companyId },
    },
    async ({ sectorId, companyId }) =>
      wrap(async () => {
        const restored = await restoreCompany(db, sectorId, companyId);
        return { summary: "restored the company to the sector", data: { restored } };
      }),
  );

  registerTool(server, db, auth, 
    "company_get",
    {
      description: "Get one company with effective fields, overrides, raw import, notes, and sectors. Returns the company.",
      inputSchema: { companyId },
    },
    async ({ companyId }) =>
      wrap(async () => {
        const company = await getCompany(db, companyId);
        return {
          summary: `company "${company.name ?? company.id}"`,
          data: { company },
        };
      }),
  );

  registerTool(server, db, auth, 
    "company_list",
    {
      description: "Search, filter, sort, and page the companies of a sector. Returns the page plus server-side durationMs.",
      inputSchema: {
        sectorId,
        search: z.string().optional().describe("Matches name, domain, and keywords"),
        country: z.array(z.string()).optional(),
        employeeBand: z.array(employeeBand).optional(),
        industry: z.array(z.string()).optional(),
        technologiesAny: z.array(z.string()).optional(),
        hasFunding: z.boolean().optional(),
        sharedDomain: z.boolean().optional(),
        includeRemoved: z.boolean().optional(),
        sort: companySort.optional(),
        order: sortOrder.optional(),
        page: z.number().int().optional(),
        pageSize: z.number().int().optional().describe("1..200"),
      },
    },
    async ({ sectorId, ...options }) =>
      wrap(async () => {
        const started = performance.now();
        const result = await listCompanies(db, sectorId, options);
        const durationMs = performance.now() - started;
        return {
          summary: `${result.total} companies (page ${result.page}/${result.totalPages})`,
          data: { ...result, durationMs },
        };
      }),
  );

  registerTool(server, db, auth, 
    "company_facets",
    {
      description: "Count a sector's live companies per country, industry, employee band, and top 50 technologies. Returns the facets.",
      inputSchema: { sectorId },
    },
    async ({ sectorId }) =>
      wrap(async () => {
        const result = await facets(db, sectorId);
        return { summary: "sector facets", data: result };
      }),
  );

  registerTool(server, db, auth, 
    "import_list",
    {
      description: "List a sector's imports, newest first. Returns the imports.",
      inputSchema: { sectorId },
    },
    async ({ sectorId }) =>
      wrap(async () => {
        const rows = await listImports(db, sectorId);
        return { summary: `${rows.length} import(s)`, data: { imports: rows } };
      }),
  );
}
