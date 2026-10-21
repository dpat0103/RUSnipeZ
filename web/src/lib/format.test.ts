import { describe, expect, it } from "vitest";
import { webregUrl } from "./config";
import { clock, duration, formatPercent, hourLabel, meetingSummary, plainText, plural, timeAgo } from "./format";

describe("format", () => {
  it("converts 24-hour times", () => {
    expect(clock("15:50")).toBe("3:50 PM");
    expect(clock("00:05")).toBe("12:05 AM");
    expect(clock("12:00")).toBe("12:00 PM");
    expect(clock(null)).toBe("");
  });

  it("summarizes meetings with readable campus names", () => {
    expect(
      meetingSummary([{ days: "TH", start: "14:00", end: "15:20", mode: "LEC", where: "TIL 232", campus: "LIV" }]),
    ).toBe("TH 2:00 PM–3:20 PM · TIL 232, Livingston");
    expect(meetingSummary([{ days: "", start: null, end: null, mode: "ONLINE", where: "", campus: "ONL" }])).toBe(
      "Online, no set time",
    );
    expect(meetingSummary([])).toBe("No meeting time listed");
  });

  it("formats relative time", () => {
    const now = Date.parse("2026-11-16T14:10:00Z");
    expect(timeAgo("2026-11-16T14:09:48Z", now)).toBe("12s ago");
    expect(timeAgo("2026-11-16T14:05:00Z", now)).toBe("5m ago");
    expect(timeAgo("2026-11-16T11:10:00Z", now)).toBe("3h ago");
    expect(timeAgo("2026-11-16T14:10:05Z", now)).toBe("0s ago");
  });

  it("formats durations, percentages and hours", () => {
    expect(duration(45)).toBe("45 sec");
    expect(duration(360)).toBe("6 min");
    expect(duration(7200)).toBe("2.0 hr");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.9871)).toBe("98.7%");
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(13)).toBe("1 PM");
    expect(plural(1, "course")).toBe("1 course");
    expect(plural(2916, "section")).toBe("2,916 sections");
  });

  it("strips markup from prerequisite notes", () => {
    expect(plainText("(01:355:101 COLLEGE WRITING )<em> OR </em>(01:355:103 EXPOSITION &amp;ARGUMENT )")).toBe(
      "(01:355:101 COLLEGE WRITING ) OR (01:355:103 EXPOSITION &ARGUMENT )",
    );
  });

  it("builds a WebReg link with the index filled in", () => {
    expect(webregUrl("12027", "25627")).toBe(
      "https://sims.rutgers.edu/webreg/editSchedule.htm?login=cas&semesterSelection=12027&indexList=25627",
    );
  });
});
