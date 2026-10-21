import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./App";
import { createQueryClient } from "./api/queryClient";
import type { Catalog, Events, HistorySummary, Meta, OpenSections, SectionHistory, Stats } from "./api/types";

const NOW = "2026-11-16T14:10:00Z";

const meta: Meta = {
  defaultTerm: "12027",
  pollSeconds: 30,
  terms: [
    { code: "12027", name: "Spring 2027", catalogs: [], lastPollAt: NOW, openCount: 1 },
    { code: "02027", name: "Winter 2027", catalogs: [], lastPollAt: NOW, openCount: 0 },
  ],
};

const stats: Stats = {
  sectionsTracked: 15657,
  openNow: 15560,
  openings24h: 42,
  openingsTotal: 42,
  uptime24h: 0.998,
  lastPollAt: NOW,
  trackingSince: "2026-11-16T09:10:00Z",
};

const events: Events = {
  term: "12027",
  events: [
    {
      kind: "opened",
      index: "25627",
      at: "2026-11-16T14:09:30Z",
      precise: true,
      campus: "NB",
      courseCode: "01:198:121",
      courseTitle: "INTRODUCTION TO COMPUTER SCIENCE",
      sectionNumber: "41",
    },
  ],
};

const catalog: Catalog = {
  meta: {
    term: "12027",
    termName: "Spring 2027",
    campus: "NB",
    generated: NOW,
    counts: { courses: 1, sections: 2, crossListed: 0, requiresSPN: 0 },
    coreCodes: { QQ: 1 },
  },
  courses: [
    {
      code: "01:198:121",
      title: "INTRODUCTION TO COMPUTER SCIENCE",
      subject: "198",
      subjectName: "Computer Science",
      school: "School of Arts and Sciences",
      schoolCode: "01",
      credits: 4,
      creditsText: "4.0 credits",
      level: "U",
      core: ["QQ"],
      synopsis: null,
      prereqs: "(01:198:120 INTRO PROGRAMMING )<em> OR </em>(01:640:112 PRECALC )",
      sections: ["25627", "25628"].map((index, i) => ({
        index,
        number: String(41 + i),
        instructors: ["AMIEL, DAVID"],
        meets: [{ days: "MW", start: "10:35", end: "11:30", mode: "LEC", where: "LSH B205", campus: "LIV" }],
        exam: null,
        spn: false,
        crossListed: [],
        subtitle: null,
        campus: "NB",
      })),
    },
  ],
};

const open: OpenSections = { term: "12027", observedAt: NOW, indexes: ["25627"] };
const history: HistorySummary = {
  term: "12027",
  generatedAt: NOW,
  sections: { "25628": { lastSeenOpen: "2026-11-16T13:10:00Z", openings7d: 2 } },
};
const section: SectionHistory = {
  term: "12027",
  index: "25628",
  courseCode: "01:198:121",
  courseTitle: "INTRODUCTION TO COMPUTER SCIENCE",
  sectionNumber: "42",
  campus: "NB",
  openNow: false,
  openSince: null,
  lastOpenedAt: "2026-11-16T13:05:00Z",
  lastSeenOpenAt: "2026-11-16T13:10:00Z",
  openings7d: 2,
  openings30d: 5,
  medianOpenSeconds: 360,
  openingsByHour: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 3 : 0)),
  recent: [],
};

let catalogBody: Catalog = catalog;

const ROUTES: [RegExp, () => unknown][] = [
  [/\/api\/v1\/meta$/, () => meta],
  [/\/api\/v1\/stats$/, () => stats],
  [/\/api\/v1\/terms\/12027\/events/, () => events],
  [/\/api\/v1\/terms\/12027\/open$/, () => open],
  [/\/api\/v1\/terms\/12027\/history$/, () => history],
  [/\/api\/v1\/terms\/12027\/sections\/25628$/, () => section],
  [/\/api\/v1\/terms\/12027\/catalogs\/NB$/, () => catalogBody],
];

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  catalogBody = catalog;
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse(NOW) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const match = ROUTES.find(([pattern]) => pattern.test(url));
      return match
        ? new Response(JSON.stringify(match[1]()), { status: 200 })
        : new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
    }),
  );
  // jsdom has no <dialog> behavior.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live page", () => {
  it("shows service stats, live status and the event feed", async () => {
    renderAt("/");
    expect(await screen.findByText("INTRODUCTION TO COMPUTER SCIENCE")).toBeInTheDocument();
    expect(screen.getByText("15,560")).toBeInTheDocument();
    expect(screen.getByText("99.8%")).toBeInTheDocument();
    // Tracking began five hours ago, so the 24-hour tiles say so.
    expect(screen.getByText(/^Openings since Nov 16/)).toBeInTheDocument();
    expect(screen.getByText("Opened")).toBeInTheDocument();
    expect(screen.getByText("30s ago")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Live · checked 0s ago");
    expect(screen.getByText("Across Spring 2027 and Winter 2027, all campuses.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "25627" })).toHaveAttribute("href", "/search?q=25627&term=12027");
  });
});

describe("search page", () => {
  it("shows live status and last-seen history for each section", async () => {
    renderAt("/search?q=computer");
    expect(await screen.findByText("1 course · 2 sections · 1 open")).toBeInTheDocument();
    const [first, second] = screen.getAllByRole("button", { name: /Sec 4/ });
    expect(within(first!).getByText("Open")).toBeInTheDocument();
    expect(within(first!).getByText("Open now")).toBeInTheDocument();
    expect(within(second!).getByText("Closed")).toBeInTheDocument();
    expect(within(second!).getByText("Seen open 1h ago")).toBeInTheDocument();
  });

  it("expands a section into its history and previews the Discord alert", async () => {
    const user = userEvent.setup();
    renderAt("/search");
    await user.click(await screen.findByRole("button", { name: /Sec 42/ }));
    expect(await screen.findByText("2 in the last 7 days · 5 in 30 days")).toBeInTheDocument();
    expect(screen.getByText("6 min (median)")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Most openings around 9 AM Eastern" })).toBeInTheDocument();
    expect(screen.getByText("(01:198:120 INTRO PROGRAMMING ) OR (01:640:112 PRECALC )")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in WebReg" })).toHaveAttribute(
      "href",
      expect.stringContaining("indexList=25628"),
    );

    await user.click(screen.getByRole("button", { name: "Get alerts for this section" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("INTRODUCTION TO COMPUTER SCIENCE is open")).toBeInTheDocument();
    expect(within(dialog).getByText("/snipe 25628")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("applies filters from the URL", async () => {
    renderAt("/search?open=1");
    expect(await screen.findByText("1 course · 1 section · 1 open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open now" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reports when nothing matches", async () => {
    renderAt("/search?q=zzzz");
    expect(await screen.findByText("No sections match. Try fewer words or clear a filter.")).toBeInTheDocument();
  });
});

describe("search results", () => {
  function manyCourses(count: number): Catalog {
    const [base] = catalog.courses;
    return {
      ...catalog,
      courses: Array.from({ length: count }, (_, i) => ({
        ...base!,
        code: `01:198:${String(100 + i)}`,
        title: `COURSE ${i}`,
        sections: base!.sections.map((section, j) => ({ ...section, index: String(30000 + i * 10 + j) })),
      })),
    };
  }

  it("collapses courses into summaries and pages through them", async () => {
    catalogBody = manyCourses(45);
    const user = userEvent.setup();
    renderAt("/search");
    expect(await screen.findByText("45 courses · 90 sections · 0 open")).toBeInTheDocument();
    const first = screen.getByRole("button", { name: /COURSE 0\b/ });
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(within(first).getByText("2 sections")).toBeInTheDocument();
    expect(screen.queryByText("Sec 41")).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(20);

    await user.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("Sec 41")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Page 3" }));
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
  });

  it("opens the course and highlights the section for an index search", async () => {
    catalogBody = manyCourses(45);
    renderAt("/search?q=30121");
    const course = await screen.findByRole("button", { name: /COURSE 12\b/ });
    expect(course).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("30121").closest("li")).toHaveAttribute("data-highlight", "true");
  });
});

describe("routing", () => {
  it("renders a not-found page for unknown paths", async () => {
    renderAt("/nope");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("falls back to the default term for an unknown term parameter", async () => {
    renderAt("/?term=99999");
    expect(await screen.findByRole("heading", { name: "Latest changes · Spring 2027" })).toBeInTheDocument();
  });
});
