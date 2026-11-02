import { expect, it } from "vitest";
import { isContactName } from "../../src/lib/contact-name.js";
import { pickContact } from "../../src/domain/icp/sheet.js";
import { pickScheduleAContact } from "../../src/domain/ria-steps/handlers.js";

it("selects a sourced person ahead of a corporate owner without changing stored owners", () => {
  for (const name of ["Example Savings Bank", "Example Advisors", "Example Asset Management,", "Example LP", "Example, L.P.", "Example Financial Planning,", "Example Foundation", "Example Group, INC. DE"]) {
    const leaders = [{ name, title: "SOLE OWNER" }, { name: "Jane Banks", title: "Chief Compliance Officer" }];
    expect(pickContact(leaders, "P")?.name).toBe("Jane Banks");
    expect(pickScheduleAContact(leaders)?.name).toBe("Jane Banks");
    expect(leaders[0]?.name).toBe(name);
    expect(pickContact(leaders.slice(0, 1), "P")).toBeNull();
  }
});

it("keeps normal personal names and comma-form officer names", () => {
  for (const name of ["Jane Banks", "BANKS, JANE, MARIE", "María García", "Anne-Marie O'Neill", "Alex Co"]) {
    expect(isContactName(name)).toBe(true);
  }
});

it("rejects role-only names and partial table fragments rather than claiming a named person", () => {
  for (const name of ["CCO", "Sponsor", "CHIEF EXECUTIVE OFFICER", "I CEO", "Sam", "ALICE", "EXAMPLE.AI", "(IRREVOCABLE)", "DATED 11.08.2023", "Example & Co.", "Example Enterprises 401(K)"]) {
    expect(isContactName(name)).toBe(false);
  }
});
