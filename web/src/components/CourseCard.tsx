import type { CatalogCourse, CatalogSection, HistorySummary } from "../api/types";
import { OFF_CAMPUS_NAMES } from "../lib/config";
import { meetingLabels, meetingPlaces, nameCase, plural, timeAgo } from "../lib/format";
import { useDemo } from "../demo/context";
import { SectionDetail } from "./SectionDetail";

interface Props {
  term: string;
  course: CatalogCourse;
  sections: CatalogSection[];
  open: Set<string> | undefined;
  history: HistorySummary | undefined;
  now: number;
  expanded: boolean;
  onToggleCourse: () => void;
  highlight: string | null;
  expandedSection: string | null;
  onToggleSection: (index: string) => void;
}

export function CourseCard(props: Props) {
  const { course, sections, open, history, now, expanded, onToggleCourse } = props;
  const credits = course.credits !== null ? `${course.credits} credits` : course.creditsText;
  const openCount = open ? sections.filter((s) => open.has(s.index)).length : null;
  const bodyId = `course-${course.code.replaceAll(":", "-")}`;

  return (
    <article className="course" data-expanded={expanded || undefined}>
      <button className="course-head" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggleCourse}>
        <span className="course-name">
          <span className="course-code">{course.code}</span>
          <span className="course-title">{course.title}</span>
          <span className="chips">
            <span className="chip chip-plain">{course.subjectName}</span>
            {credits && <span className="chip">{credits}</span>}
            {course.fee !== null && <span className="chip">${course.fee.toFixed(0)} fee</span>}
            {course.core.slice(0, 4).map((code) => (
              <span className="chip chip-core" key={code}>
                {code}
              </span>
            ))}
          </span>
        </span>
        <span className="course-summary">
          <span>{plural(sections.length, "section")}</span>
          {openCount !== null && (
            <span className={openCount ? "open-count" : "open-count is-zero"}>{openCount} open</span>
          )}
        </span>
        <span className="chevron" aria-hidden="true" />
      </button>

      {expanded && (
        <ul className="sections" id={bodyId}>
          {sections.map((section) => (
            <SectionItem key={section.index} {...props} section={section} seenAt={history?.sections[section.index]?.lastSeenOpen} now={now} />
          ))}
        </ul>
      )}
    </article>
  );
}

function SectionItem({
  term,
  course,
  section,
  open,
  seenAt,
  now,
  highlight,
  expandedSection,
  onToggleSection,
}: Props & { section: CatalogSection; seenAt: string | undefined }) {
  const isOpen = open?.has(section.index);
  const watching = useDemo().isWatched(section.index);
  const isExpanded = expandedSection === section.index;
  const status = open ? (isOpen ? "open" : "closed") : "unknown";
  // Off-campus meetings use the host college's building codes; name the location instead.
  const places = OFF_CAMPUS_NAMES[section.campus] ?? meetingPlaces(section.meets);

  return (
    <li className="section" data-status={status} data-highlight={highlight === section.index || undefined}>
      <button className="section-row" aria-expanded={isExpanded} onClick={() => onToggleSection(section.index)}>
        <span className={`pill pill-${status === "open" ? "opened" : status}`}>
          {status === "open" ? "Open" : status === "closed" ? "Closed" : "…"}
        </span>
        <span className="section-id">
          <span className="section-number">Sec {section.number}</span>
          <span className="index">{section.index}</span>
        </span>
        <span className="section-main">
          <span className="section-who">
            {section.instructors.length ? section.instructors.map(nameCase).join(", ") : "Instructor TBA"}
          </span>
          <span className="meetings">
            {meetingLabels(section.meets).map((label) => (
              <span className="meeting" key={label}>
                {label}
              </span>
            ))}
            {places && <span className="place">{places}</span>}
          </span>
        </span>
        <span className="section-seen">
          {isOpen ? "Open now" : seenAt ? `Seen open ${timeAgo(seenAt, now)}` : "Not seen open"}
        </span>
        <span className="badges">
          {watching && <span className="badge badge-watch">Watching</span>}
          {section.format !== "in-person" && (
            <span className="badge badge-format">{section.format === "online" ? "Online" : "Hybrid"}</span>
          )}
          {section.honors && <span className="badge badge-honors">Honors</span>}
          {(section.eligibility || section.openTo) && (
            <span
              className="badge badge-restricted"
              title={[section.eligibility && nameCase(section.eligibility), section.openTo].filter(Boolean).join(" · ")}
            >
              Restricted
            </span>
          )}
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
        <SectionDetail term={term} course={course} section={section} />
      )}
    </li>
  );
}
