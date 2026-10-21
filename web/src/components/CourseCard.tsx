import type { CatalogCourse, CatalogSection, HistorySummary } from "../api/types";
import { meetingSummary, timeAgo } from "../lib/format";
import { SectionDetail } from "./SectionDetail";

interface Props {
  term: string;
  course: CatalogCourse;
  sections: CatalogSection[];
  open: Set<string> | undefined;
  history: HistorySummary | undefined;
  now: number;
  expanded: string | null;
  onToggle: (index: string) => void;
  onPreview: (course: CatalogCourse, section: CatalogSection) => void;
}

export function CourseCard({ term, course, sections, open, history, now, expanded, onToggle, onPreview }: Props) {
  const credits = course.credits !== null ? `${course.credits} cr` : course.creditsText;
  return (
    <article className="course">
      <header className="course-head">
        <span className="course-code">{course.code}</span>
        <h3>{course.title}</h3>
        <span className="chips">
          {credits && <span className="chip">{credits}</span>}
          {course.core.slice(0, 3).map((code) => (
            <span className="chip chip-core" key={code}>
              {code}
            </span>
          ))}
        </span>
      </header>
      <ul className="sections">
        {sections.map((section) => {
          const isOpen = open?.has(section.index);
          const seen = history?.sections[section.index];
          const isExpanded = expanded === section.index;
          return (
            <li key={section.index} className="section" data-open={isOpen || undefined}>
              <button
                className="section-row"
                aria-expanded={isExpanded}
                onClick={() => onToggle(section.index)}
              >
                <span className={`pill ${open ? (isOpen ? "pill-opened" : "pill-closed") : "pill-unknown"}`}>
                  {open ? (isOpen ? "Open" : "Closed") : "…"}
                </span>
                <span className="index">{section.index}</span>
                <span className="section-main">
                  <span className="section-who">
                    Section {section.number} · {section.instructors.join(", ") || "Instructor TBA"}
                  </span>
                  <span className="section-when">{meetingSummary(section.meets)}</span>
                </span>
                <span className="section-seen">
                  {isOpen
                    ? "Open now"
                    : seen
                      ? `Seen open ${timeAgo(seen.lastSeenOpen, now)}`
                      : "Not seen open"}
                </span>
                <span className="badges">
                  {section.spn && (
                    <span className="badge badge-spn" title="Needs a special permission number">
                      SPN
                    </span>
                  )}
                  {section.crossListed.length > 0 && (
                    <span className="badge badge-xl" title={`Cross-listed as ${section.crossListed.join(", ")}`}>
                      XL
                    </span>
                  )}
                </span>
                <span className="chevron" aria-hidden="true" />
              </button>
              {isExpanded && (
                <SectionDetail
                  term={term}
                  course={course}
                  section={section}
                  onPreview={() => onPreview(course, section)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </article>
  );
}
