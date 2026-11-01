import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Stats } from "../api/types";
import { StatTiles } from "./StatTiles";

const NOW = Date.parse("2026-11-16T14:10:00Z");
const stats: Stats = {
  sectionsTracked: 3, openNow: 2, openings24h: 0, openingsTotal: 0,
  medianOpenSeconds7d: null, medianOpenSamples7d: 0,
  checks24h: 2880, uptime24h: 1, lastPollAt: new Date(NOW).toISOString(),
  openObservedAt: new Date(NOW - 300_000).toISOString(),
  trackingSince: "2026-11-01T00:00:00Z", alertsSentTotal: 0, alertsSent24h: 0,
  medianAlertSeconds7d: null, gotInTotal: 0,
};

describe("live metric states", () => {
  it("marks stale availability using the accepted snapshot, even when a held check is fresh", () => {
    render(<StatTiles stats={stats} now={NOW} pollSeconds={30} />);
    expect(screen.getByText("Open at last update")).toBeInTheDocument();
    expect(screen.queryByText("Open right now")).not.toBeInTheDocument();
    expect(screen.getByText("5 min")).toBeInTheDocument();
    expect(screen.getByText("delayed · last trusted update")).toBeInTheDocument();
    expect(screen.getByText("no timed closures yet")).toBeInTheDocument();
    expect(screen.queryByText(/Uptime/)).not.toBeInTheDocument();
  });

  it("does not claim zero open sections before the first accepted snapshot", () => {
    render(<StatTiles stats={{ ...stats, openNow: 0, openObservedAt: null }} now={NOW} pollSeconds={30} />);
    const tile = screen.getByText("Open right now").closest("div")!;
    expect(within(tile).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("waiting for the first update")).toBeInTheDocument();
  });
});
