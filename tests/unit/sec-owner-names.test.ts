import { expect, it } from "vitest";
import { bestContact, contactCandidates, filingPeople, FILING_NAMES_STATUS, FILING_PEOPLE, formatFiledName } from "../../src/domain/sec-adv/contact-people.js";
import { scheduleAPeople } from "../../src/domain/sec-adv/owner-names.js";
import { selectFiling, type Filing } from "../../src/domain/sec-adv/schedules.js";

it("formats SEC LAST, FIRST, MIDDLE names without inventing missing parts", () => {
  expect(formatFiledName(" EXAMPLE,  JANE, Q ")).toBe("JANE Q EXAMPLE");
  expect(formatFiledName("EXAMPLE, JANE,")).toBe("JANE EXAMPLE");
  expect(formatFiledName("Jane   Example")).toBe("Jane Example");
  expect(formatFiledName("EXAMPLE,,JANE")).toBe("JANE EXAMPLE");
});

it("selects the latest filing by CRD, timestamp and numeric filing ID, never firm name", () => {
  const picked = new Map<string, Filing>();
  const crds = new Set(["910001", "910002"]);
  for (const row of [
    { "1E1": "910001", FilingID: "2", DateSubmitted: "12/31/2024 10:00:00 AM" },
    { "1E1": "910001", FilingID: "9", DateSubmitted: "12/31/2024 01:00:00 PM" },
    { "1E1": "910001", FilingID: "10", DateSubmitted: "12/31/2024 01:00:00 PM" },
    { "1E1": "910001", FilingID: "99", DateSubmitted: "12/30/2024 11:00:00 PM" },
    { "1E1": "910003", FilingID: "100", DateSubmitted: "01/02/2025" },
    { "1E1": "910002", FilingID: "101", DateSubmitted: "01/01/2025" },
  ]) selectFiling(picked, row, crds, "9999-12-31");
  expect([...picked.values()].map(f => [f.crd, f.id, f.date])).toEqual([["910001", "10", "2024-12-31"], ["910002", "101", "2025-01-01"]]);
});

it("imports individuals in Schedule A only, deduplicates rows and omits sensitive OwnerID", () => {
  const row = { FilingID: "10", Schedule: "A", "Full Legal Name": "EXAMPLE, JANE, Q", "Title or Status": "OWNER",
    "DE/FE/I": "I", "Ownership Code": "E", "Control Person": "Y", OwnerID: "never-store-this" };
  const people = scheduleAPeople([row, row, { ...row, Schedule: "B" }, { ...row, "DE/FE/I": "DE" },
    { ...row, "DE/FE/I": "FE" }, { ...row, "DE/FE/I": "" }]);
  expect(people).toHaveLength(1);
  expect(people[0]).toMatchObject({ name: "JANE Q EXAMPLE", title: "OWNER", ownership_range: "75% or more", control_person: true,
    verification: "unconfirmed_public_filing" });
  expect(JSON.stringify(people)).not.toContain("never-store-this");
  expect(scheduleAPeople([{ ...row, "Ownership Code": "NA", "Control Person": "N" }])[0]).toMatchObject({
    ownership_range: "under 5%", control_person: false });
});

it("chooses owner for Tier 0, founder/managing partner then office/ops for Tier 1, ops/CCO/founder for Tier 2", () => {
  const founder = { name: "Alex Example", title: "Founder" };
  const partner = { name: "Robin Example", title: "Managing Partner" };
  const ops = { name: "Morgan Example", title: "Director of Operations" };
  const coo = { name: "Chris Example", title: "COO" };
  const head = { name: "Drew Example", title: "Head of Operations" };
  const cco = { name: "Sam Example", title: "Chief Compliance Officer" };
  const office = { name: "Terry Example", title: "Office Manager" };
  const owner = { name: "Jamie Example", title: "President", ownershipCode: "E", controlPerson: true };
  expect(bestContact([cco, founder, owner], 0)).toEqual(owner);
  expect(bestContact([office, ops, founder], 1)).toEqual(founder);
  expect(bestContact([office, partner], 1)).toEqual(partner);
  expect(bestContact([cco, office], 1)).toEqual(office);
  for (const operations of [ops, coo, head]) expect(bestContact([founder, cco, operations], 2)).toEqual(operations);
  expect(bestContact([founder, cco], 2)).toEqual(cco);
  expect(bestContact([founder], 2)).toEqual(founder);
  expect(bestContact([{ name: "Example Holdings LLC", title: "OWNER", entityType: "domestic_entity" }], 0)).toBeNull();
});

it("retains confirmed names and titles when the filing disagrees and selects only the latest filing", () => {
  const rows = [
    { type: "leader", data: { name: "Jane Example", title: "Confirmed CEO" }, verification: "verified" },
    { type: FILING_NAMES_STATUS, data: { filing_id: "10", filing_date: "2024-12-31", people: 1 } },
    { type: FILING_PEOPLE, data: { name: "Jane Example", title: "Outdated Owner", filing_id: "10", filing_date: "2024-12-31", ownership_code: "E" } },
    { type: FILING_PEOPLE, data: { name: "Former Person", title: "Founder", filing_id: "9", filing_date: "2023-12-31" } },
  ];
  const before = JSON.stringify(rows);
  expect(contactCandidates(rows)).toEqual([expect.objectContaining({ name: "Jane Example", title: "Confirmed CEO", verification: "verified" })]);
  expect(filingPeople(rows)).toHaveLength(1);
  expect(filingPeople(rows)[0]).toMatchObject({ title: "Outdated Owner", filingId: "10", verification: "unconfirmed_public_filing" });
  expect(JSON.stringify(rows)).toBe(before);
});

it("keeps every reported role when one filed person has multiple statuses", () => {
  const rows = [
    { type: FILING_NAMES_STATUS, data: { filing_id: "10", filing_date: "2024-12-31" } },
    ...[{ name: "Alex Example", title: "Founder" }, { name: "Alex Example", title: "COO" },
      { name: "Sam Example", title: "CCO" }].map(p => ({ type: FILING_PEOPLE,
      data: { ...p, filing_id: "10", filing_date: "2024-12-31" } })),
  ];
  expect(filingPeople(rows)).toHaveLength(3);
  expect(contactCandidates(rows)).toHaveLength(2);
  expect(bestContact(contactCandidates(rows), 2)).toMatchObject({ name: "Alex Example", title: "COO; Founder" });
});
