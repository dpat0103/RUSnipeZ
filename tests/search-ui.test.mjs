import { test } from "node:test";
import assert from "node:assert/strict";
import { expandAbbreviations, queryTerms, score, filtered } from "../web/js/search.js";
import { openSetDiff } from "../web/js/detection.js";
import { state } from "../web/js/state.js";
import { DEFAULT_FILTERS } from "../web/js/config.js";

function course(title, code, index, instructor = "", subject = "") {
  return {
    title, code, core: [],
    _title: `${title} ${expandAbbreviations(title)}`.toLowerCase(),
    _code: code.toLowerCase(), _who: instructor.toLowerCase(), _subject: subject.toLowerCase(),
    _indexes: new Set([index]),
    sections: [{ index, spn: false, _locs: new Set(["BUS"]), _days: new Set(["M", "W"]) }],
  };
}
const fixtures = [
  course("COLLEGE WRITING", "01:355:101", "10001"),
  course("INTRO COMPUTER SCI", "01:198:111", "10002"),
  course("MICROBIOL HLTH SCI", "01:119:131", "10003"),
  course("ADV ORGANIC CHEM I", "01:160:401", "10004", "Writing", "Computer Science"),
];

test("abbreviations expand whole words and ignore unknown words", () => {
  assert.equal(expandAbbreviations("MICROBIOL HLTH SCI"), "microbiology health science");
  assert.equal(expandAbbreviations("ADV ORGANIC CHEM I"), "advanced chemistry");
  assert.equal(expandAbbreviations("INTRO COMPUTER SCI"), "introduction science");
  assert.equal(expandAbbreviations("BIOLOGY CHEMICAL"), "");
});

test("query terms normalize case, skip stopwords and retain stopword-only queries", () => {
  assert.deepEqual(queryTerms(" Intro to COMPUTER science "), ["intro", "computer", "science"]);
  assert.deepEqual(queryTerms("to the"), ["to", "the"]);
  assert.deepEqual(queryTerms("  "), []);
});

test("student queries rank the intended course first", () => {
  for (const [q, title] of [
    ["expository writing", "COLLEGE WRITING"],
    ["intro to computer science", "INTRO COMPUTER SCI"],
    ["microbiology health science", "MICROBIOL HLTH SCI"],
    ["advanced organic chemistry", "ADV ORGANIC CHEM I"],
  ]) {
    state.courses = fixtures;
    state.filters = { ...DEFAULT_FILTERS, q };
    assert.equal(filtered()[0].course.title, title);
  }
});

test("index and code matches outrank title, instructor and subject matches", () => {
  const title = course("WRITING", "01:001:101", "10001");
  const instructor = course("OTHER", "01:002:101", "10002", "Writing");
  const subject = course("OTHER", "01:003:101", "10003", "", "Writing");
  assert.ok(score(title, ["writing"]) > score(instructor, ["writing"]));
  assert.ok(score(instructor, ["writing"]) > score(subject, ["writing"]));
  assert.ok(score(title, ["10001"]) > score(title, ["01:001:101"]));
  assert.ok(score(title, ["01:001:101"]) > score(title, ["writing"]));
  assert.equal(score(title, ["missing"]), 0);
  assert.doesNotThrow(() => score(title, ["[", "*", "."]));
});

test("section filters combine and open-only waits for a baseline", () => {
  state.courses = fixtures;
  state.open = new Set(["10002"]);
  state.seenBaseline = false;
  state.filters = { ...DEFAULT_FILTERS, openOnly: true, loc: "BUS", days: "MW" };
  assert.equal(filtered().length, fixtures.length);
  state.seenBaseline = true;
  assert.equal(filtered()[0].course.title, "INTRO COMPUTER SCI");
  state.filters.days = "F";
  assert.equal(filtered().length, 0);
});

test("set difference is pure and scoped to the selected catalog", () => {
  const previous = new Set(["10001", "99999"]), next = new Set(["10002", "88888"]);
  assert.deepEqual(openSetDiff(previous, next, new Set(["10001", "10002"])), {
    opened: ["10002"], closed: ["10001"],
  });
  assert.deepEqual([...previous], ["10001", "99999"]);
  assert.deepEqual([...next], ["10002", "88888"]);
});
