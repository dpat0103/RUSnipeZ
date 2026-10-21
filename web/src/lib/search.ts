import type { CatalogCourse, CatalogSection, SectionFormat } from "../api/types";

/**
 * Rutgers abbreviates course titles heavily ("MICROBIOL HLTH SCI",
 * "ADV ORGANIC CHEM I"), so the expanded form is added to the searchable text
 * and someone typing the full words still finds the course.
 */
export const ABBREVIATIONS: Record<string, string> = {
  adv: "advanced", amer: "american", anal: "analysis", appl: "applied",
  biol: "biology", chem: "chemistry", comp: "computer computational",
  dev: "development", econ: "economics", elem: "elementary", engr: "engineering",
  environ: "environmental", hist: "history", hlth: "health", intr: "introduction",
  intro: "introduction", interm: "intermediate", lang: "language", lit: "literature",
  math: "mathematics", mgmt: "management", microbiol: "microbiology", org: "organic",
  phys: "physics", prin: "principles", prob: "probability", psych: "psychology",
  sci: "science", stat: "statistics", struct: "structures", sys: "systems",
  thry: "theory", writ: "writing",
};

// These match most of the catalog and distort ranking if scored.
const STOPWORDS = new Set(["to", "of", "the", "and", "in", "for", "a", "an", "i", "ii"]);

export function expandAbbreviations(title: string): string {
  return title
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((word) => ABBREVIATIONS[word] ?? "")
    .filter(Boolean)
    .join(" ");
}

export function queryTerms(query: string): string[] {
  const all = query.toLowerCase().split(/\s+/).filter(Boolean);
  const meaningful = all.filter((term) => !STOPWORDS.has(term));
  return meaningful.length ? meaningful : all;
}

export interface PreparedSection {
  section: CatalogSection;
  days: Set<string>;
  /** Start of each timed meeting, in minutes after midnight. */
  starts: number[];
}

export interface PreparedCourse {
  course: CatalogCourse;
  sections: PreparedSection[];
  /** The title as written, lowercase, for phrase matches. */
  rawTitle: string;
  /** The title plus expanded abbreviations, lowercase. */
  title: string;
  code: string;
  instructors: string;
  subject: string;
  indexes: Set<string>;
}

/** Precompute lowercase search fields once per catalog, not per keystroke. */
export function prepareCourses(courses: CatalogCourse[]): PreparedCourse[] {
  return courses.map((course) => ({
    course,
    sections: course.sections.map((section) => ({
      section,
      days: new Set(section.meets.flatMap((m) => [...m.days])),
      starts: section.meets.flatMap((m) => (m.start ? [minutes(m.start)] : [])),
    })),
    rawTitle: course.title.toLowerCase(),
    title: `${course.title} ${expandAbbreviations(course.title)}`.toLowerCase(),
    code: course.code.toLowerCase(),
    instructors: course.sections.flatMap((s) => s.instructors).join(" ").toLowerCase(),
    subject: course.subjectName.toLowerCase(),
    indexes: new Set(course.sections.map((s) => s.index)),
  }));
}

const minutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export type TimeOfDay = "morning" | "afternoon" | "evening";

/** Start-time windows, in minutes after midnight: before noon, noon to 5 PM, 5 PM on. */
export const TIME_WINDOWS: Record<TimeOfDay, [number, number]> = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
};

/** Every timed meeting starts in the window; sections with no set time never match. */
export function meetsDuring(starts: number[], time: TimeOfDay): boolean {
  const [from, to] = TIME_WINDOWS[time];
  return starts.length > 0 && starts.every((start) => start >= from && start < to);
}

/** "4+" matches four or more credits; other values match exactly. */
export function creditsMatch(credits: number | null, wanted: string): boolean {
  if (credits === null) return false;
  return wanted === "4+" ? credits >= 4 : credits === Number(wanted);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Field weights: an exact index is unambiguous, a course code nearly so; a word
// in the title beats an instructor name, which beats the department name.
export const WEIGHTS = {
  index: 1000,
  code: 60,
  titleWordStart: 40,
  instructor: 30,
  titleSubstring: 22,
  subject: 12,
  // Ranking signals on top of the per-term scores.
  phrase: 50,
  undergraduate: 8,
  maxSectionBonus: 7,
} as const;

export interface Rank {
  score: number;
  matchedAll: boolean;
}

/**
 * Each query term is scored against the course's fields independently and the
 * best field wins. Terms are summed rather than all required, so
 * "expository writing" still reaches COLLEGE WRITING; matching every term
 * doubles the score. Small signals then order close results: the whole query
 * as a phrase in the title, undergraduate level (most visitors are
 * undergraduates), and a capped bonus for courses with more sections.
 */
export function rank(course: PreparedCourse, terms: string[]): Rank {
  let total = 0;
  let matched = 0;
  for (const term of terms) {
    let best = 0;
    if (course.indexes.has(term)) best = WEIGHTS.index;
    else if (course.code.includes(term)) best = WEIGHTS.code;
    else if (course.title.includes(term)) {
      // The only regex in search: does the term start a word ("chem" in
      // "organic chemistry") or sit inside one ("chem" in "biochemistry")?
      best = new RegExp(`\\b${escapeRegExp(term)}`).test(course.title)
        ? WEIGHTS.titleWordStart
        : WEIGHTS.titleSubstring;
    } else if (course.instructors.includes(term)) best = WEIGHTS.instructor;
    else if (course.subject.includes(term)) best = WEIGHTS.subject;
    if (best > 0) matched += 1;
    total += best;
  }
  if (matched === 0) return { score: 0, matchedAll: false };
  const matchedAll = matched === terms.length;
  if (matchedAll) total *= 2;
  if (terms.length > 1 && course.rawTitle.includes(terms.join(" "))) total += WEIGHTS.phrase;
  if (course.course.level === "U") total += WEIGHTS.undergraduate;
  // Capped so it never outweighs a real match.
  total += Math.min(WEIGHTS.maxSectionBonus, Math.log2(1 + course.course.sections.length) * 2);
  return { score: total, matchedAll };
}

export function score(course: PreparedCourse, terms: string[]): number {
  return rank(course, terms).score;
}

export type Sort = "relevance" | "open" | "code";

export interface Filters {
  q: string;
  core: string;
  days: string;
  openOnly: boolean;
  hideSpn: boolean;
  sort: Sort;
  /** Subject code, such as "198". */
  subject?: string;
  format?: SectionFormat | "";
  time?: TimeOfDay | "";
  level?: "U" | "G" | "";
  credits?: string;
  honors?: boolean;
}

export interface Match {
  course: CatalogCourse;
  sections: CatalogSection[];
  relevance: number;
  matchedAll: boolean;
}

/**
 * Courses matching the filters, with only their matching sections.
 *
 * If any course matches every query term, partial matches are dropped:
 * "computer science" should not list every course that mentions "science".
 * Only when nothing matches every term do partial matches appear, which is
 * what lets "expository writing" find COLLEGE WRITING.
 */
export function filterCourses(
  courses: PreparedCourse[],
  filters: Filters,
  open: Set<string> | undefined,
): Match[] {
  const terms = queryTerms(filters.q);
  const days = [...filters.days];
  let matches: Match[] = [];

  for (const prepared of courses) {
    const { course } = prepared;
    if (filters.core && !course.core.includes(filters.core)) continue;
    if (filters.subject && course.subject !== filters.subject) continue;
    if (filters.level && course.level !== filters.level) continue;
    if (filters.credits && !creditsMatch(course.credits, filters.credits)) continue;
    const { score: relevance, matchedAll } = terms.length
      ? rank(prepared, terms)
      : { score: 0, matchedAll: true };
    if (terms.length && relevance === 0) continue;

    const sections = prepared.sections
      .filter(({ section, days: meets, starts }) => {
        if (filters.hideSpn && section.spn) return false;
        if (filters.honors && !section.honors) return false;
        if (filters.format && section.format !== filters.format) return false;
        if (filters.time && !meetsDuring(starts, filters.time)) return false;
        // Open-only applies once live status has loaded.
        if (filters.openOnly && open && !open.has(section.index)) return false;
        return days.every((day) => meets.has(day));
      })
      .map(({ section }) => section);
    if (sections.length) matches.push({ course, sections, relevance, matchedAll });
  }

  if (matches.some((m) => m.matchedAll)) matches = matches.filter((m) => m.matchedAll);

  const byCode = (a: Match, b: Match) => a.course.code.localeCompare(b.course.code);
  const openCount = (m: Match) => (open ? m.sections.filter((s) => open.has(s.index)).length : 0);
  const order: Record<Sort, (a: Match, b: Match) => number> = {
    relevance: terms.length ? (a, b) => b.relevance - a.relevance || byCode(a, b) : byCode,
    open: (a, b) => openCount(b) - openCount(a) || byCode(a, b),
    code: byCode,
  };
  return matches.sort(order[filters.sort]);
}
