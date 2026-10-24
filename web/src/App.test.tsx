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
  medianOpenSeconds7d: 240,
  checks24h: 5760,
  uptime24h: 0.998,
  lastPollAt: NOW,
  trackingSince: "2026-11-16T09:10:00Z",
  alertsSentTotal: 128,
  alertsSent24h: 12,
  medianAlertSeconds7d: 1.4,
  gotInTotal: 9,
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
    {
      kind: "closed",
      index: "26181",
      at: "2026-11-16T14:05:00Z",
      precise: true,
      campus: "CM",
      courseCode: "50:014:340",
      courseTitle: "CIVIL RIGHTS MOVEMENT",
      sectionNumber: "01",
    },
    {
      kind: "closed",
      index: "26188",
      at: "2026-11-16T14:04:00Z",
      precise: true,
      campus: null,
      courseCode: null,
      courseTitle: null,
      sectionNumber: null,
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
      fee: null,
      notes: null,
      sections: ["25627", "25628"].map((index, i) => ({
        index,
        number: String(41 + i),
        instructors: ["AMIEL, DAVID"],
        meets: [{ days: "MW", start: "10:35", end: "11:30", mode: "LEC", where: "LSH B205", campus: "LIV" }],
        exam: null,
        spn: false,
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
        ...(i === 1 && {
          format: "hybrid" as const,
          honors: true,
          eligibility: "JUNIORS AND SENIORS",
          openTo: "MAJ: 198 (Computer Science)",
          comments: ["First 7 weeks"],
          spn: true,
          spnFrom: "Department staff",
          crossListed: ["30001"],
        }),
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
  instructors: "AMIEL, DAVID",
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
let openBody: OpenSections = open;

const ROUTES: [RegExp, () => unknown][] = [
  [/\/api\/v1\/meta$/, () => meta],
  [/\/api\/v1\/stats$/, () => stats],
  [/\/api\/v1\/terms\/12027\/events/, () => events],
  [/\/api\/v1\/terms\/12027\/open$/, () => openBody],
  [/\/api\/v1\/terms\/12027\/history$/, () => history],
  [/\/api\/v1\/terms\/12027\/sections\/25628$/, () => section],
  [
    /\/api\/v1\/terms\/12027\/sections\/26188$/,
    () => ({ ...section, index: "26188", courseCode: null, courseTitle: null, sectionNumber: null, instructors: null, campus: null }),
  ],
  [/\/api\/v1\/terms\/12027\/catalogs\/NB$/, () => catalogBody],
];

function renderAt(path: string, client = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  catalogBody = catalog;
  openBody = open;
  sessionStorage.clear();
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
    expect(screen.getByText("4 min")).toBeInTheDocument();
    expect(screen.getByText("5,760")).toBeInTheDocument();
    // The bot's delivery numbers.
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("1.4 s")).toBeInTheDocument();
    // Tracking began five hours ago, so the 24-hour tiles say so.
    expect(screen.getByText(/^Openings since Nov 16/)).toBeInTheDocument();
    const feed = within(screen.getByRole("region", { name: /Latest changes/ }));
    expect(feed.getByText("Opened")).toBeInTheDocument();
    expect(feed.getByText("30s ago")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Live · checked 0s ago");
    expect(screen.getByText(/^Across Spring 2027 and Winter 2027, all campuses · 42 openings recorded since/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "25627" })).toHaveAttribute("href", "/search?q=25627&term=12027");
  });
});

describe("sections Rutgers has not listed", () => {
  it("are labeled in the feed, and feed links open the section's own campus", async () => {
    renderAt("/");
    const feed = within(await screen.findByRole("region", { name: /Latest changes/ }));
    expect(await feed.findByText("Not in Rutgers' public schedule yet")).toBeInTheDocument();
    expect(feed.getByRole("link", { name: "26181" })).toHaveAttribute(
      "href",
      "/search?q=26181&term=12027&campus=CM",
    );
  });

  it("explain themselves when searched by index", async () => {
    renderAt("/search?q=26188");
    expect(await screen.findByText("Index 26188 is not in Rutgers' public schedule")).toBeInTheDocument();
    expect(screen.getByText(/Rutgers marks new sections open before listing them/)).toBeInTheDocument();
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

  it("expands a section into its history", async () => {
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

  });

  it("applies filters from the URL", async () => {
    renderAt("/search?open=1");
    expect(await screen.findByText("1 course · 1 section · 1 open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open now" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reports when nothing matches", async () => {
    renderAt("/search?q=zzzz");
    expect(await screen.findByText("No sections match. Try fewer words or remove a filter.")).toBeInTheDocument();
  });
});

describe("search filters and details", () => {
  it("shows every detail Rutgers gives for a section", async () => {
    const user = userEvent.setup();
    renderAt("/search");
    const row = await screen.findByRole("button", { name: /Sec 42/ });
    for (const badge of ["Hybrid", "Honors", "Restricted", "SPN", "XL"]) {
      expect(within(row).getByText(badge)).toBeInTheDocument();
    }
    await user.click(row);
    expect(await screen.findByText("Hybrid: some meetings online")).toBeInTheDocument();
    expect(screen.getByText("Juniors And Seniors")).toBeInTheDocument();
    expect(screen.getByText("MAJ: 198 (Computer Science)")).toBeInTheDocument();
    expect(screen.getByText("Needed to register; issued by department staff.")).toBeInTheDocument();
    expect(screen.getByText("First 7 weeks")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "30001" })).toHaveAttribute("href", "/search?q=30001&term=12027");
  });

  it("opens more filters, applies them from the URL and removes them as chips", async () => {
    const user = userEvent.setup();
    renderAt("/search?format=hybrid&honors=1");
    expect(await screen.findByText("1 course · 1 section · 0 open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters · 2" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Format" })).toHaveValue("hybrid");
    expect(screen.getByRole("checkbox", { name: "Honors sections only" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Remove Hybrid" }));
    expect(screen.getByRole("button", { name: "Filters · 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(await screen.findByText("1 course · 2 sections · 1 open")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Level" }), "G");
    expect(await screen.findByText("No sections match. Try fewer words or remove a filter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Graduate" })).toBeInTheDocument();
  });

  it("lists departments from the catalog", async () => {
    const user = userEvent.setup();
    renderAt("/search");
    await user.click(await screen.findByRole("button", { name: "Filters" }));
    expect(screen.getByRole("option", { name: "Computer Science (198)" })).toBeInTheDocument();
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

describe("discord preview", () => {
  const panel = () => screen.getByRole("complementary", { name: "Discord preview" });
  const thread = () => within(panel()).getByRole("list", { name: "Conversation with RU SnipeZ" });
  const snipeList = () => within(panel()).getByRole("region", { name: "Snipe list" });

  async function command(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.type(within(panel()).getByRole("textbox", { name: "Command" }), `${text}{Enter}`);
  }

  it("snipes a section from the search results", async () => {
    const user = userEvent.setup();
    renderAt("/search");
    await user.click(await screen.findByRole("button", { name: /Sec 42/ }));
    await user.click(screen.getByRole("button", { name: "Snipe this section" }));

    expect(within(thread()).getByText("/snipe 25628")).toBeInTheDocument();
    expect(within(thread()).getByText("Now watching INTRODUCTION TO COMPUTER SCIENCE")).toBeInTheDocument();
    expect(within(thread()).getByText(/You will get a DM the moment it opens · 1\/15 watches/)).toBeInTheDocument();
    expect(within(snipeList()).getByText("Sec 42 · 25628 · Closed")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /Sec 42/ })).getByText("Watching")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Watching · run /snipe again" }));
    expect(within(thread()).getByText("You are already watching 25628.")).toBeInTheDocument();
  });

  it("answers every typed command", async () => {
    const user = userEvent.setup();
    renderAt("/search");
    await screen.findByText("1 course · 2 sections · 1 open");

    await command(user, "/snipe 25627");
    expect(await within(thread()).findByText("INTRODUCTION TO COMPUTER SCIENCE is open right now")).toBeInTheDocument();
    expect(within(thread()).getByRole("link", { name: "Register" })).toHaveAttribute(
      "href",
      expect.stringContaining("indexList=25627"),
    );

    await command(user, "/check");
    expect(await within(thread()).findByText("Your snipe list (1/15)")).toBeInTheDocument();

    await command(user, "/lastopen 25628");
    expect(await within(thread()).findByText("6 min")).toBeInTheDocument();

    await command(user, "/course 01:198:121");
    expect(await within(thread()).findByText("Spring 2027 · NB · 1 of 2 open")).toBeInTheDocument();

    await command(user, "/status");
    expect(await within(thread()).findByText("RU SnipeZ is checking Rutgers every 30 seconds")).toBeInTheDocument();

    await command(user, "/help");
    expect(within(thread()).getByText("RU SnipeZ commands")).toBeInTheDocument();

    await command(user, "/remove 25627");
    expect(within(thread()).getByText("Stopped watching 25627")).toBeInTheDocument();
    expect(within(snipeList()).getByText(/Open a section and choose Snipe/)).toBeInTheDocument();

    await command(user, "/snipe 99999");
    expect(await within(thread()).findByText("Could not find index 99999 in Spring 2027.")).toBeInTheDocument();

    await command(user, "/frobnicate");
    expect(within(thread()).getByText("Unknown command /frobnicate. Try /help.")).toBeInTheDocument();
  });

  it("asks before clearing the list", async () => {
    const user = userEvent.setup();
    renderAt("/search");
    await screen.findByText("1 course · 2 sections · 1 open");
    await command(user, "/snipe 25627");
    await command(user, "/snipe 25628");
    expect(await within(snipeList()).findByText("2/15")).toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "/clear" }));
    expect(await within(thread()).findByText("Stop watching all 2 sections?")).toBeInTheDocument();
    await user.click(within(thread()).getByRole("button", { name: "Clear all" }));
    expect(within(thread()).getByText("Cleared 2 sections.")).toBeInTheDocument();
    expect(within(snipeList()).getByText("0/15")).toBeInTheDocument();
  });

  it("sends the alert DM when a watched section opens, and its buttons work", async () => {
    const user = userEvent.setup();
    const client = createQueryClient();
    renderAt("/search", client);
    await screen.findByText("1 course · 2 sections · 1 open");
    await command(user, "/snipe 25628");
    expect(await within(snipeList()).findByText("Sec 42 · 25628 · Closed")).toBeInTheDocument();

    openBody = { ...open, indexes: ["25627", "25628"] };
    await client.invalidateQueries({ queryKey: ["open"] });
    expect(await within(thread()).findByText("Direct message")).toBeInTheDocument();
    expect(within(thread()).getByText("INTRODUCTION TO COMPUTER SCIENCE is open")).toBeInTheDocument();

    await user.click(within(thread()).getByRole("button", { name: "I got in" }));
    expect(
      within(thread()).getByText("Nice. Removed it and its cross-listed sections from your list."),
    ).toBeInTheDocument();
    expect(within(thread()).getByRole("button", { name: "Snooze 1h" })).toBeDisabled();
    expect(within(snipeList()).getByText("0/15")).toBeInTheDocument();
  });

  it("keeps the list across a reload of the same tab", async () => {
    const user = userEvent.setup();
    const first = renderAt("/search");
    await screen.findByText("1 course · 2 sections · 1 open");
    await command(user, "/snipe 25627");
    expect(await within(snipeList()).findByText("Sec 41 · 25627 · Open")).toBeInTheDocument();
    first.unmount();

    const second = renderAt("/search");
    expect(await within(snipeList()).findByText("Sec 41 · 25627 · Open")).toBeInTheDocument();
    expect(within(thread()).getByText("/snipe 25627")).toBeInTheDocument();
    second.unmount();

    // Closing the tab clears sessionStorage; a new visit starts empty.
    sessionStorage.clear();
    renderAt("/search");
    expect(await within(snipeList()).findByText("0/15")).toBeInTheDocument();
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
