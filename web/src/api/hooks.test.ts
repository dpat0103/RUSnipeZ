import { describe, expect, it } from "vitest";
import { nextMetaRefetch } from "./hooks";
import type { Meta } from "./types";

const at = (iso: string) => Date.parse(iso);
const meta = (lastPollAt: string | null): Meta => ({
  defaultTerm: "12027",
  pollSeconds: 30,
  terms: [
    { code: "12027", name: "Spring 2027", catalogs: [], lastPollAt, openCount: 0 },
    { code: "02027", name: "Winter 2027", catalogs: [], lastPollAt: null, openCount: 0 },
  ],
});

describe("nextMetaRefetch", () => {
  it("waits until just after the next check is due", () => {
    // Checked 10 s ago: the next check lands in 20 s, plus a 3 s margin, capped at 15 s.
    expect(nextMetaRefetch(meta("2026-11-16T14:00:00Z"), at("2026-11-16T14:00:10Z"))).toBe(15_000);
    expect(nextMetaRefetch(meta("2026-11-16T14:00:00Z"), at("2026-11-16T14:00:20Z"))).toBe(13_000);
  });

  it("retries every two seconds once a check is overdue", () => {
    expect(nextMetaRefetch(meta("2026-11-16T14:00:00Z"), at("2026-11-16T14:00:40Z"))).toBe(2_000);
  });

  it("falls back to the normal interval without data", () => {
    expect(nextMetaRefetch(undefined, 0)).toBe(15_000);
    expect(nextMetaRefetch(meta(null), 0)).toBe(15_000);
  });
});
