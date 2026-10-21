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
    fee: null,
    notes: null,
    sections: [
      {
        index,
        number: "01",
        instructors: instructor ? [instructor] : [],
        meets: [{ days: "MW", start: "10:20", end: "11:40", mode: "LEC", where: "HH A1", campus: "CAC" }],
        exam: null,
        spn,
        spnFrom: null,
        format: "in-person",
        honors: false,
        eligibility: null,
        openTo: null,
        comments: [],
        notes: null,
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

const NONE: Filters = { q: "", core: "", days: "", openOnly: false, hideSpn: false, sort: "relevance" };

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

  it("drops partial matches when some course matches every term", () => {
    const titles = filterCourses(FIXTURES, { ...NONE, q: "computer science" }, undefined).map((m) => m.course.title);
    // MICROBIOL HLTH SCI matches only "science", so it is left out.
    expect(titles).toEqual(["INTRO COMPUTER SCI", "ADV ORGANIC CHEM I"]);
    expect(filterCourses(FIXTURES, { ...NONE, q: "computer science" }, undefined).every((m) => m.matchedAll)).toBe(true);
  });

  it("falls back to partial matches when nothing matches every term", () => {
    const matches = filterCourses(FIXTURES, { ...NONE, q: "expository writing" }, undefined);
    expect(matches[0]?.course.title).toBe("COLLEGE WRITING");
    expect(matches.every((m) => !m.matchedAll)).toBe(true);
  });

  it("ranks a match at the start of a title word above one inside a word", () => {
    const [organic, bio] = prepareCourses([
      course("ORGANIC CHEMISTRY", "01:160:307", "20001"),
      course("BIOCHEMISTRY", "01:694:301", "20002"),
    ]);
    expect(score(organic!, ["chem"]) - score(bio!, ["chem"])).toBeCloseTo((40 - 22) * 2, 5);
  });

  it("prefers the title phrase and undergraduate courses among full matches", () => {
    const courses = prepareCourses([
      { ...course("SEL PROB COMP SCI", "16:198:685", "40001"), level: "G" },
      { ...course("RESEARCH IN COMPUTER SCIENCE MS THESIS", "16:198:701", "40002"), level: "G" },
      course("INTRODUCTION TO COMPUTER SCIENCE", "01:198:111", "40003"),
    ]);
    // Give the graduate course many sections, as independent studies have.
    courses[0]!.course.sections = Array.from({ length: 55 }, () => courses[0]!.course.sections[0]!);
    expect(filterCourses(courses, { ...NONE, q: "computer science" }, undefined).map((m) => m.course.code)).toEqual([
      "01:198:111",
      "16:198:701",
      "16:198:685",
    ]);
  });

  it("sorts by open sections or by code on request", () => {
    const open = new Set(["10003", "10004"]);
    expect(filterCourses(FIXTURES, { ...NONE, sort: "open" }, open).map((m) => m.course.code).slice(0, 2)).toEqual([
      "01:119:131",
      "01:160:401",
    ]);
    expect(filterCourses(FIXTURES, { ...NONE, q: "writing", sort: "code" }, undefined).map((m) => m.course.code)).toEqual([
      "01:160:401",
      "01:355:101",
    ]);
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

  it("filters by subject, level and credits", () => {
    const courses = prepareCourses([
      { ...course("DATA STRUCTURES", "01:198:112", "50001"), credits: 4 },
      { ...course("SEMINAR", "16:198:500", "50002"), level: "G", credits: 3 },
      { ...course("RESEARCH", "01:198:499", "50003"), credits: null },
      course("CALCULUS I", "01:640:151", "50004"),
    ]);
    const codes = (extra: Partial<Filters>) => filterCourses(courses, { ...NONE, ...extra }, undefined).map((m) => m.course.code);
    expect(codes({ subject: "640" })).toEqual(["01:640:151"]);
    expect(codes({ level: "G" })).toEqual(["16:198:500"]);
    expect(codes({ credits: "3" })).toEqual(["01:640:151", "16:198:500"]);
    expect(codes({ credits: "4+" })).toEqual(["01:198:112"]);
  });

  it("filters sections by format, honors and time of day", () => {
    const base = course("PHYSICS", "01:750:203", "60001");
    const section = base.sections[0]!;
    const [prepared] = prepareCourses([
      {
        ...base,
        sections: [
          { ...section, index: "60001", meets: [{ ...section.meets[0]!, start: "08:30" }] },
          { ...section, index: "60002", format: "online", honors: true, meets: [] },
          { ...section, index: "60003", format: "hybrid", meets: [{ ...section.meets[0]!, start: "18:00" }] },
          { ...section, index: "60004", meets: [{ ...section.meets[0]!, start: "11:30" }, { ...section.meets[0]!, start: "13:00" }] },
        ],
      },
    ]);
    const indexes = (extra: Partial<Filters>) =>
      filterCourses([prepared!], { ...NONE, ...extra }, undefined).flatMap((m) => m.sections.map((s) => s.index));
    expect(indexes({ format: "online" })).toEqual(["60002"]);
    expect(indexes({ honors: true })).toEqual(["60002"]);
    expect(indexes({ time: "morning" })).toEqual(["60001"]);
    expect(indexes({ time: "evening" })).toEqual(["60003"]);
    // A morning lecture with an afternoon recitation is in neither window.
    expect(indexes({ time: "afternoon" })).toEqual([]);
  });

  it("ignores open-only until live status has loaded", () => {
    expect(filterCourses(FIXTURES, { ...NONE, openOnly: true }, undefined)).toHaveLength(4);
  });
});
