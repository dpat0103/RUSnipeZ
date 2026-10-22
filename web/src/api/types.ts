// Mirrors src/rusnipez/api/schemas.py and the catalog payload from
// src/rusnipez/catalog/build.py. Timestamps are ISO 8601 strings in UTC.

export type Campus = "NB" | "NK" | "CM";

export interface CatalogInfo {
  campus: Campus;
  courses: number;
  sections: number;
  generatedAt: string;
}

export interface TermInfo {
  code: string;
  name: string | null;
  catalogs: CatalogInfo[];
  lastPollAt: string | null;
  openCount: number;
}

export interface Meta {
  defaultTerm: string;
  pollSeconds: number;
  terms: TermInfo[];
}

export interface Stats {
  sectionsTracked: number;
  openNow: number;
  openings24h: number;
  openingsTotal: number;
  medianOpenSeconds7d: number | null;
  checks24h: number;
  uptime24h: number | null;
  lastPollAt: string | null;
  trackingSince: string | null;
}

export interface OpenSections {
  term: string;
  observedAt: string | null;
  indexes: string[];
}

export interface SeatEvent {
  kind: "opened" | "closed";
  index: string;
  at: string;
  precise: boolean;
  campus: Campus | null;
  courseCode: string | null;
  courseTitle: string | null;
  sectionNumber: string | null;
}

export interface Events {
  term: string;
  events: SeatEvent[];
}

export interface HistorySummary {
  term: string;
  generatedAt: string;
  sections: Record<string, { lastSeenOpen: string; openings7d: number }>;
}

export interface PastOpening {
  openedAt: string;
  closedAt: string | null;
  openedPrecise: boolean;
}

export interface SectionHistory {
  term: string;
  index: string;
  courseCode: string | null;
  courseTitle: string | null;
  sectionNumber: string | null;
  instructors: string | null;
  campus: Campus | null;
  openNow: boolean;
  openSince: string | null;
  lastOpenedAt: string | null;
  lastSeenOpenAt: string | null;
  openings7d: number;
  openings30d: number;
  medianOpenSeconds: number | null;
  openingsByHour: number[];
  recent: PastOpening[];
}

export interface Meeting {
  days: string;
  start: string | null;
  end: string | null;
  mode: string;
  where: string;
  campus: string;
}

export type SectionFormat = "in-person" | "hybrid" | "online";

export interface CatalogSection {
  index: string;
  number: string;
  instructors: string[];
  meets: Meeting[];
  exam: string | null;
  spn: boolean;
  /** Who issues special permission numbers, such as "Department staff". */
  spnFrom: string | null;
  crossListed: string[];
  subtitle: string | null;
  campus: string;
  format: SectionFormat;
  honors: boolean;
  /** Class-year restriction, such as "JUNIORS AND SENIORS". */
  eligibility: string | null;
  /** Major or minor restriction, such as "MAJ: 198 (Computer Science)". */
  openTo: string | null;
  comments: string[];
  notes: string | null;
}

export interface CatalogCourse {
  code: string;
  title: string;
  subject: string;
  subjectName: string;
  school: string;
  schoolCode: string;
  credits: number | null;
  creditsText: string | null;
  level: string;
  core: string[];
  synopsis: string | null;
  prereqs: string | null;
  fee: number | null;
  notes: string | null;
  sections: CatalogSection[];
}

export interface Catalog {
  meta: {
    term: string;
    termName: string;
    campus: Campus;
    generated: string;
    counts: { courses: number; sections: number; crossListed: number; requiresSPN: number };
    coreCodes: Record<string, number>;
  };
  courses: CatalogCourse[];
}
