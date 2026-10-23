import { Link } from "react-router";
import { useSection } from "../api/hooks";
import { CAMPUS_NAMES } from "../lib/config";
import { dateTime } from "../lib/format";

/**
 * An index the search found no course for. Rutgers can mark a section open
 * before it lists the section publicly, so say what is known about its seats.
 */
export function UnlistedSection({ term, index }: { term: string; index: string }) {
  const section = useSection(term, index);
  const h = section.data;

  if (section.isPending) return null;
  if (h?.campus) {
    const params = new URLSearchParams({ q: index, term });
    if (h.campus !== "NB") params.set("campus", h.campus);
    return (
      <div className="unlisted" role="status">
        <strong>
          Index {index} is a {CAMPUS_NAMES[h.campus]} section
        </strong>
        <p>
          <Link to={{ pathname: "/search", search: `?${params}` }}>Show it on that campus</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="unlisted" role="status">
      <strong>Index {index} is not in Rutgers&apos; public schedule</strong>
      {h ? (
        <p>
          {h.openNow ? (
            <>
              It is <span className="pill pill-opened">Open</span>
              {h.openSince ? ` since ${dateTime(h.openSince)}` : ""}.
            </>
          ) : (
            <>
              It is <span className="pill pill-closed">Closed</span>
              {h.lastSeenOpenAt ? `; last seen open ${dateTime(h.lastSeenOpenAt)}` : ""}.
            </>
          )}{" "}
          Rutgers marks new sections open before listing them, so the course details will appear here once it
          does. The catalog is checked every 6 hours.
        </p>
      ) : (
        <p>RU SnipeZ has not seen this index open or listed. Check the number, or try another campus.</p>
      )}
    </div>
  );
}
