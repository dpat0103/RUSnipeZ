import { describe, expect, it } from "vitest";
import type { CatalogCourse } from "../api/types";
import { expandAbbreviations, filterCourses, prepareCourses, queryTerms, score, type Filters } from "./search";

function course(title: string, code: string, index: string, instructor = "", subject = "", spn = false): CatalogCourse {
  return {
    code,
    title,
    subject: code.split(":")[1] ?? "",
    subjectName: subject,
    school: "",
    schoolCode: "01",
    credits: 3,
    creditsText: null,
    level: "U",
    core: title === "COLLEGE WRITING" ? ["WCr"] : [],
    synopsis: null,
    prereqs: null,
    sections: [
      {
        index,
        number: "01",
        instructors: instructor ? [instructor] : [],
        meets: [{ days: "MW", start: "10:20", end: "11:40", mode: "LEC", where: "HH A1", campus: "CAC" }],
        exam: null,
        spn,
        crossListed: [],
        subtitle: null,
        campus: "NB",
      },
    ],
  };
}

const FIXTURES = prepareCourses([
  course("COLLEGE WRITING", "01:355:101", "10001"),
  course("INTRO COMPUTER SCI", "01:198:111", "10002"),
  course("MICROBIOL HLTH SCI", "01:119:131", "10003", "", "", true),
  course("ADV ORGANIC CHEM I", "01:160:401", "10004", "Writing", "Computer Science"),
]);

const NONE: Filters = { q: "", core: "", days: "", openOnly: false, hideSpn: false };

describe("search", () => {
  it("expands whole-word abbreviations and ignores unknown words", () => {
    expect(expandAbbreviations("MICROBIOL HLTH SCI")).toBe("microbiology health science");
    expect(expandAbbreviations("ADV ORGANIC CHEM I")).toBe("advanced chemistry");
    expect(expandAbbreviations("BIOLOGY CHEMICAL")).toBe("");
  });

  it("normalizes query terms, dropping stopwords unless nothing else is left", () => {
    expect(queryTerms(" Intro to COMPUTER science ")).toEqual(["intro", "computer", "science"]);
    expect(queryTerms("to the")).toEqual(["to", "the"]);
    expect(queryTerms("  ")).toEqual([]);
  });

  it.each([
    ["expository writing", "COLLEGE WRITING"],
    ["intro to computer science", "INTRO COMPUTER SCI"],
    ["microbiology health science", "MICROBIOL HLTH SCI"],
    ["advanced organic chemistry", "ADV ORGANIC CHEM I"],
    ["10002", "INTRO COMPUTER SCI"],
  ])("ranks the intended course first for %j", (q, title) => {
    expect(filterCourses(FIXTURES, { ...NONE, q }, undefined)[0]?.course.title).toBe(title);
  });

  it("scores index over code over title over instructor over subject", () => {
    const [title] = prepareCourses([course("WRITING", "01:001:101", "10001")]);
    const [instructor] = prepareCourses([course("OTHER", "01:002:101", "10002", "Writing")]);
    const [subject] = prepareCourses([course("OTHER", "01:003:101", "10003", "", "Writing")]);
    expect(score(title!, ["writing"])).toBeGreaterThan(score(instructor!, ["writing"]));
    expect(score(instructor!, ["writing"])).toBeGreaterThan(score(subject!, ["writing"]));
    expect(score(title!, ["10001"])).toBeGreaterThan(score(title!, ["01:001:101"]));
    expect(score(title!, ["missing"])).toBe(0);
    expect(() => score(title!, ["[", "*", "."])).not.toThrow();
  });

  it("lists everything by course code when there is no query", () => {
    expect(filterCourses(FIXTURES, NONE, undefined).map((m) => m.course.code)).toEqual([
      "01:119:131",
      "01:160:401",
      "01:198:111",
      "01:355:101",
    ]);
  });

  it("filters by core, days, SPN and open status", () => {
    expect(filterCourses(FIXTURES, { ...NONE, core: "WCr" }, undefined)).toHaveLength(1);
    expect(filterCourses(FIXTURES, { ...NONE, days: "MW" }, undefined)).toHaveLength(4);
    expect(filterCourses(FIXTURES, { ...NONE, days: "F" }, undefined)).toHaveLength(0);
    expect(filterCourses(FIXTURES, { ...NONE, hideSpn: true }, undefined)).toHaveLength(3);
    const open = new Set(["10002"]);
    expect(filterCourses(FIXTURES, { ...NONE, openOnly: true }, open).map((m) => m.course.title)).toEqual([
      "INTRO COMPUTER SCI",
    ]);
  });

  it("ignores open-only until live status has loaded", () => {
    expect(filterCourses(FIXTURES, { ...NONE, openOnly: true }, undefined)).toHaveLength(4);
  });
});
