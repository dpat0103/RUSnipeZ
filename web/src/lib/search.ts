import type { CatalogCourse, CatalogSection } from "../api/types";

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
}

export interface PreparedCourse {
  course: CatalogCourse;
  sections: PreparedSection[];
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
    })),
    title: `${course.title} ${expandAbbreviations(course.title)}`.toLowerCase(),
    code: course.code.toLowerCase(),
    instructors: course.sections.flatMap((s) => s.instructors).join(" ").toLowerCase(),
    subject: course.subjectName.toLowerCase(),
    indexes: new Set(course.sections.map((s) => s.index)),
  }));
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Tokens score independently and sum, rather than all being required, so
 * "expository writing" still finds COLLEGE WRITING. Matching every token
 * still ranks highest.
 */
export function score(course: PreparedCourse, terms: string[]): number {
  let total = 0;
  let matched = 0;
  for (const term of terms) {
    let best = 0;
    if (course.indexes.has(term)) best = 1000;
    else if (course.code.includes(term)) best = 60;
    else if (course.title.includes(term)) {
      best = new RegExp(`\\b${escapeRegExp(term)}`).test(course.title) ? 40 : 22;
    } else if (course.instructors.includes(term)) best = 30;
    else if (course.subject.includes(term)) best = 12;
    if (best > 0) matched += 1;
    total += best;
  }
  if (matched === 0) return 0;
  if (matched === terms.length) total *= 2;
  // Break ties toward courses with many sections, capped so it never outweighs a match.
  return total + Math.min(15, Math.log2(1 + course.course.sections.length) * 2.2);
}

export interface Filters {
  q: string;
  core: string;
  days: string;
  openOnly: boolean;
  hideSpn: boolean;
}

export interface Match {
  course: CatalogCourse;
  sections: CatalogSection[];
  relevance: number;
}

/** Courses matching the filters, with only their matching sections, best first. */
export function filterCourses(
  courses: PreparedCourse[],
  filters: Filters,
  open: Set<string> | undefined,
): Match[] {
  const terms = queryTerms(filters.q);
  const days = [...filters.days];
  const matches: Match[] = [];

  for (const prepared of courses) {
    if (filters.core && !prepared.course.core.includes(filters.core)) continue;
    const relevance = terms.length ? score(prepared, terms) : 0;
    if (terms.length && relevance === 0) continue;

    const sections = prepared.sections
      .filter(({ section, days: meets }) => {
        if (filters.hideSpn && section.spn) return false;
        // Open-only applies once live status has loaded.
        if (filters.openOnly && open && !open.has(section.index)) return false;
        return days.every((day) => meets.has(day));
      })
      .map(({ section }) => section);
    if (sections.length) matches.push({ course: prepared.course, sections, relevance });
  }

  const byCode = (a: Match, b: Match) => a.course.code.localeCompare(b.course.code);
  return matches.sort(terms.length ? (a, b) => b.relevance - a.relevance || byCode(a, b) : byCode);
}
