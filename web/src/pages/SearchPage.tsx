import { useDeferredValue, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useCatalog, useHistory, useOpenSections } from "../api/hooks";
import type { Campus, CatalogCourse, CatalogSection } from "../api/types";
import { AlertPreview } from "../components/AlertPreview";
import { CourseCard } from "../components/CourseCard";
import { CAMPUSES, CAMPUS_NAMES, DAYS } from "../lib/config";
import { formatCount, plural } from "../lib/format";
import { useNow, useTerm } from "../lib/hooks";
import { filterCourses, prepareCourses, type Filters } from "../lib/search";

const PAGE = 25;

function readFilters(params: URLSearchParams): Filters & { campus: Campus } {
  const campus = params.get("campus");
  return {
    campus: CAMPUSES.includes(campus as Campus) ? (campus as Campus) : "NB",
    q: params.get("q") ?? "",
    core: params.get("core") ?? "",
    days: [...(params.get("days") ?? "")].filter((d) => "MTWHF".includes(d)).join(""),
    openOnly: params.get("open") === "1",
    hideSpn: params.get("spn") === "hide",
  };
}

export function SearchPage() {
  const { term, info } = useTerm();
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const query = useDeferredValue(filters.q);

  const catalog = useCatalog(term, filters.campus);
  const open = useOpenSections(term);
  const history = useHistory(term);
  const now = useNow(30_000);

  const [shown, setShown] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ course: CatalogCourse; section: CatalogSection } | null>(null);

  const prepared = useMemo(() => (catalog.data ? prepareCourses(catalog.data.courses) : []), [catalog.data]);
  const matches = useMemo(
    () =>
      filterCourses(
        prepared,
        { q: query, core: filters.core, days: filters.days, openOnly: filters.openOnly, hideSpn: filters.hideSpn },
        open.data?.indexes,
      ),
    [prepared, query, filters.core, filters.days, filters.openOnly, filters.hideSpn, open.data],
  );

  const update = (changes: Record<string, string | null>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
    setShown(PAGE);
  };

  const sectionCount = matches.reduce((n, m) => n + m.sections.length, 0);
  const openCount = open.data
    ? matches.reduce((n, m) => n + m.sections.filter((s) => open.data.indexes.has(s.index)).length, 0)
    : null;
  const coreCodes = Object.keys(catalog.data?.meta.coreCodes ?? {});
  const filtered = Boolean(filters.q || filters.core || filters.days || filters.openOnly || filters.hideSpn);

  return (
    <>
      <section className="page-head">
        <h1>Search sections</h1>
        <p className="lead">
          Live status for every section{info?.name ? ` in ${info.name}` : ""}, with when each one
          was last seen open.
        </p>
      </section>

      <div className="filters" role="search">
        <label className="search-box">
          <span className="visually-hidden">Search</span>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Course, code, instructor or index"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="filter-row">
          <label>
            <span className="visually-hidden">Campus</span>
            <select value={filters.campus} onChange={(e) => update({ campus: e.target.value === "NB" ? null : e.target.value })}>
              {CAMPUSES.map((c) => (
                <option key={c} value={c}>
                  {CAMPUS_NAMES[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="visually-hidden">Core requirement</span>
            <select value={filters.core} onChange={(e) => update({ core: e.target.value || null })}>
              <option value="">Any core requirement</option>
              {coreCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <div className="toggle-group" role="group" aria-label="Meets on">
            {DAYS.map(([code, label]) => {
              const active = filters.days.includes(code);
              return (
                <button
                  key={code}
                  className="toggle"
                  aria-pressed={active}
                  onClick={() =>
                    update({
                      days: [..."MTWHF"].filter((d) => (d === code ? !active : filters.days.includes(d))).join("") || null,
                    })
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button className="toggle" aria-pressed={filters.openOnly} onClick={() => update({ open: filters.openOnly ? null : "1" })}>
            Open now
          </button>
          <button className="toggle" aria-pressed={filters.hideSpn} onClick={() => update({ spn: filters.hideSpn ? null : "hide" })}>
            Hide SPN
          </button>
          {filtered && (
            <button className="link-button" onClick={() => update({ q: null, core: null, days: null, open: null, spn: null })}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {catalog.isError ? (
        <p className="empty">The catalog could not be loaded. Retrying automatically.</p>
      ) : !catalog.data ? (
        <div className="skeleton-list" aria-label="Loading catalog" />
      ) : (
        <>
          <p className="results-label" aria-live="polite">
            {matches.length
              ? `${plural(matches.length, "course")} · ${plural(sectionCount, "section")}${
                  openCount !== null ? ` · ${formatCount(openCount)} open` : ""
                }`
              : "No sections match. Try fewer words or clear a filter."}
          </p>
          <div className="results">
            {matches.slice(0, shown).map(({ course, sections }) => (
              <CourseCard
                key={course.code}
                term={term!}
                course={course}
                sections={sections}
                open={open.data?.indexes}
                history={history.data}
                now={now}
                expanded={expanded}
                onToggle={(index) => setExpanded((current) => (current === index ? null : index))}
                onPreview={(c, s) => setPreview({ course: c, section: s })}
              />
            ))}
          </div>
          {matches.length > shown && (
            <button className="button show-more" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, matches.length - shown)} more of {formatCount(matches.length - shown)}
            </button>
          )}
        </>
      )}

      {preview && term && (
        <AlertPreview
          term={term}
          termName={info?.name ?? term}
          course={preview.course}
          section={preview.section}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
