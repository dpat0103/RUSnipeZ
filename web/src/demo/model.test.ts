import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY,
  WATCH_LIMIT,
  loadState,
  newlyOpened,
  parseCommand,
  reducer,
  saveState,
  snipeResult,
  type DemoState,
  type Watch,
} from "./model";

function watch(index: string, overrides: Partial<Watch> = {}): Watch {
  return {
    term: "12027",
    termName: "Spring 2027",
    index,
    campus: "NB",
    courseCode: "01:198:111",
    courseTitle: "INTRO COMPUTER SCI",
    sectionNumber: "01",
    instructors: [],
    meets: [],
    spn: false,
    crossListed: [],
    snoozedUntil: null,
    ...overrides,
  };
}

const withWatches = (count: number): DemoState => ({
  ...EMPTY,
  watches: Array.from({ length: count }, (_, i) => watch(String(10000 + i))),
});

describe("parseCommand", () => {
  it.each([
    ["/snipe 12345", { name: "snipe", index: "12345" }],
    ["  /REMOVE   12345 ", { name: "remove", index: "12345" }],
    ["lastopen 12345", { name: "lastopen", index: "12345" }],
    ["/course 01:198:111", { name: "course", code: "01:198:111" }],
    ["/check", { name: "check" }],
    ["/clear", { name: "clear" }],
    ["/status", { name: "status" }],
    ["/help", { name: "help" }],
  ])("parses %j", (text, expected) => {
    expect(parseCommand(text)).toEqual(expected);
  });

  it.each([
    ["/snipe", "/snipe needs a 5-digit index, like /snipe 12345."],
    ["/snipe 1234", "/snipe needs a 5-digit index, like /snipe 12345."],
    ["/course intro", "/course needs a course code, like /course 01:198:111."],
    ["/register 12345", "Unknown command /register. Try /help."],
    ["", "Unknown command. Try /help."],
  ])("explains %j", (text, error) => {
    expect(parseCommand(text)).toEqual({ error });
  });
});

describe("reducer", () => {
  it("adds watches once and respects the limit", () => {
    let state = reducer(EMPTY, { type: "add-watch", watch: watch("10001") });
    state = reducer(state, { type: "add-watch", watch: watch("10001") });
    expect(state.watches).toHaveLength(1);
    const full = withWatches(WATCH_LIMIT);
    expect(reducer(full, { type: "add-watch", watch: watch("99999") })).toBe(full);
  });

  it("treats the same index in another term as a different watch", () => {
    const state = reducer(withWatches(1), { type: "add-watch", watch: watch("10000", { term: "02027" }) });
    expect(state.watches).toHaveLength(2);
    expect(reducer(state, { type: "remove-watch", term: "02027", index: "10000" }).watches).toEqual([
      state.watches[0],
    ]);
  });

  it("numbers messages and keeps the most recent 60", () => {
    let state = EMPTY;
    for (let i = 0; i < 65; i++) state = reducer(state, { type: "post", command: "/help", reply: { type: "help" }, at: i });
    expect(state.messages).toHaveLength(60);
    expect(state.messages[0]?.id).toBe(6);
    expect(state.nextId).toBe(66);
  });

  it("resolves a clear confirmation and records handled alerts", () => {
    let state = reducer(withWatches(2), {
      type: "post",
      command: "/clear",
      reply: { type: "clear-confirm", count: 2, resolution: "pending" },
      at: 0,
    });
    state = reducer(state, { type: "resolve-clear", id: 1, confirmed: true });
    expect(state.messages[0]?.reply).toEqual({ type: "clear-confirm", count: 2, resolution: "confirmed" });

    state = reducer(state, {
      type: "post",
      command: null,
      reply: { type: "alert", watch: watch("10000"), preview: true, handled: null },
      at: 0,
    });
    state = reducer(state, { type: "alert-handled", id: 2, handled: "snoozed" });
    expect(state.messages[1]?.reply).toMatchObject({ type: "alert", handled: "snoozed" });
  });

  it("snoozes one watch and resets everything", () => {
    const state = reducer(withWatches(2), { type: "snooze", term: "12027", index: "10001", until: 99 });
    expect(state.watches.map((w) => w.snoozedUntil)).toEqual([null, 99]);
    expect(reducer(state, { type: "reset" })).toEqual(EMPTY);
  });
});

describe("snipeResult", () => {
  it("reports added, duplicate and limit", () => {
    expect(snipeResult([], watch("10001"))).toBe("added");
    expect(snipeResult([watch("10001")], watch("10001"))).toBe("duplicate");
    expect(snipeResult(withWatches(WATCH_LIMIT).watches, watch("99999"))).toBe("limit");
  });
});

describe("newlyOpened", () => {
  const open = (...indexes: string[]) => new Map([["12027", new Set(indexes)]]);

  it("alerts only on a closed-to-open change", () => {
    const watches = [watch("10001"), watch("10002")];
    const first = newlyOpened(new Map(), watches, open("10002"), 0);
    expect(first.alerts).toEqual([]); // first sighting is a baseline
    const second = newlyOpened(first.next, watches, open("10001", "10002"), 0);
    expect(second.alerts.map((w) => w.index)).toEqual(["10001"]);
    expect(newlyOpened(second.next, watches, open("10001", "10002"), 0).alerts).toEqual([]);
  });

  it("skips snoozed watches and terms without data", () => {
    const snoozed = [watch("10001", { snoozedUntil: 1000 })];
    const before = newlyOpened(new Map(), snoozed, open(), 0).next;
    expect(newlyOpened(before, snoozed, open("10001"), 500).alerts).toEqual([]);
    expect(newlyOpened(before, snoozed, new Map([["12027", undefined]]), 500).next).toEqual(before);
  });
});

describe("session storage", () => {
  afterEach(() => sessionStorage.clear());

  it("round-trips state and ignores corrupt data", () => {
    const state = withWatches(2);
    saveState(state);
    expect(loadState()).toEqual(state);
    sessionStorage.setItem("rusnipez.discord-preview.v1", "{not json");
    expect(loadState()).toEqual(EMPTY);
    sessionStorage.setItem("rusnipez.discord-preview.v1", JSON.stringify({ watches: "x" }));
    expect(loadState()).toEqual(EMPTY);
  });
});
