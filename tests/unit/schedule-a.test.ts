import { describe, expect, it } from "vitest";
import { cleanScheduleATitle, parseScheduleA } from "../../src/lib/sec/schedule-a.js";
import type { PdfTextItem } from "../../src/lib/sec/pdf-text.js";

const it_ = (page: number, x: number, y: number, str: string): PdfTextItem => ({ page, x, y, str });

function heading(page = 3): PdfTextItem[] {
  return [it_(page, 40, 700, "Schedule A"), it_(page, 120, 700, "Direct Owners and Executive Officers")];
}

describe("parseScheduleA layout 1: header row with column bands", () => {
  it("reads name, title and date acquired per row", () => {
    const items: PdfTextItem[] = [
      ...heading(),
      it_(3, 40, 660, "Full Legal Name"), it_(3, 240, 660, "Title or Status"), it_(3, 430, 660, "Date Title Acquired"),
      it_(3, 40, 630, "Doe, Jane A"), it_(3, 240, 630, "Chief Executive Officer"), it_(3, 430, 630, "01/15/2019"),
      it_(3, 40, 605, "Smith, John B"), it_(3, 240, 605, "Chief Compliance Officer"), it_(3, 430, 605, "03/01/2021"),
      it_(4, 40, 700, "Schedule B"), it_(4, 120, 700, "Indirect Owners"),
      it_(4, 40, 660, "Shouldnot, Appear"), it_(4, 240, 660, "Owner"), it_(4, 430, 660, "01/01/2000"),
    ];
    expect(parseScheduleA(items)).toEqual([
      { name: "Doe, Jane A", title: "Chief Executive Officer", titleSince: "01/15/2019" },
      { name: "Smith, John B", title: "Chief Compliance Officer", titleSince: "03/01/2021" },
    ]);
  });
});

describe("parseScheduleA layout 2: wrapped titles, no separate header cells", () => {
  it("joins wrapped title lines and anchors rows on the date", () => {
    const items: PdfTextItem[] = [
      ...heading(),
      it_(3, 40, 630, "Roe, Richard C"), it_(3, 300, 630, "Managing Member and"), it_(3, 470, 630, "06/30/2018"),
      it_(3, 300, 612, "Chief Operating Officer"),
      it_(3, 40, 580, "Lee, Amy D"), it_(3, 300, 580, "President"), it_(3, 470, 580, "11/05/2022"),
    ];
    const out = parseScheduleA(items);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: "Roe, Richard C", titleSince: "06/30/2018" });
    expect(out[0]?.title).toContain("Chief Operating Officer");
    expect(out[1]).toMatchObject({ name: "Lee, Amy D", title: "President" });
  });
});

describe("parseScheduleA layout 3: entity owners mixed with officers", () => {
  it("keeps entity rows with their status and skips the header repeats", () => {
    const items: PdfTextItem[] = [
      ...heading(2),
      it_(2, 40, 660, "Full Legal Name"), it_(2, 260, 660, "Title or Status"), it_(2, 450, 660, "Date Title Acquired"),
      it_(2, 40, 630, "Example Holdings LLC"), it_(2, 260, 630, "Member"), it_(2, 450, 630, "02/01/2015"),
      it_(2, 40, 605, "Park, Susan E"), it_(2, 260, 605, "Chief Financial Officer"), it_(2, 450, 605, "09/12/2020"),
      it_(3, 40, 700, "Full Legal Name"), it_(3, 260, 700, "Title or Status"), it_(3, 450, 700, "Date Title Acquired"),
      it_(3, 40, 670, "Park, Susan E"), it_(3, 260, 670, "Chief Financial Officer"), it_(3, 450, 670, "09/12/2020"),
    ];
    const out = parseScheduleA(items);
    expect(out).toEqual([
      { name: "Example Holdings LLC", title: "Member", titleSince: "02/01/2015" },
      { name: "Park, Susan E", title: "Chief Financial Officer", titleSince: "09/12/2020" },
    ]);
  });

  it("returns nothing without a Schedule A heading", () => {
    expect(parseScheduleA([it_(1, 40, 700, "Item 1 Identifying Information")])).toEqual([]);
  });

  it("strips ownership-column debris from titles", () => {
    expect(cleanScheduleATitle("I CHIEF COMPLIANCE OFFICER")).toBe("CHIEF COMPLIANCE OFFICER");
    expect(cleanScheduleATitle("DE MANAGING MEMBER")).toBe("MANAGING MEMBER");
    expect(cleanScheduleATitle("I OWNER, PRINCIPAL, DIRECTOR")).toBe("OWNER, PRINCIPAL, DIRECTOR");
    expect(cleanScheduleATitle("Chief Operating Officer")).toBe("Chief Operating Officer");
    const items: PdfTextItem[] = [
      ...heading(),
      it_(3, 40, 660, "Full Legal Name"), it_(3, 240, 660, "Title or Status"), it_(3, 430, 660, "Date Title Acquired"),
      it_(3, 40, 630, "Doe, Jane A"), it_(3, 240, 630, "I CHIEF COMPLIANCE OFFICER"), it_(3, 430, 630, "01/15/2019"),
    ];
    expect(parseScheduleA(items)[0]?.title).toBe("CHIEF COMPLIANCE OFFICER");
  });
});
