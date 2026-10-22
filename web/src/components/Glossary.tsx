import { Link } from "react-router";
import { CORE_CODES, TAGS, TERMS, type Term } from "../lib/glossary";

function Entry({ term }: { term: Term }) {
  return (
    <div className="gloss-entry">
      <dt>
        <span className={term.look ?? "gloss-plain"}>{term.label}</span>
      </dt>
      <dd>{term.meaning}</dd>
    </div>
  );
}

/** The compact guide that opens from the search results. */
export function TagGuide({ id }: { id: string }) {
  return (
    <section className="tag-guide" id={id} aria-label="What the tags mean">
      <dl className="gloss-grid">
        {[...TAGS, ...TERMS.slice(0, 2)].map((term) => (
          <Entry key={term.label} term={term} />
        ))}
        <div className="gloss-entry">
          <dt>
            <span className="chip chip-core">QR</span>
          </dt>
          <dd>A core requirement the course fulfills. All core codes are in the full glossary.</dd>
        </div>
      </dl>
      <Link className="link-button" to="/how-it-works#glossary">
        Full glossary
      </Link>
    </section>
  );
}

/** Every term, for the How it works page. */
export function Glossary() {
  return (
    <div className="glossary">
      <h3>Tags on a section</h3>
      <dl className="gloss-grid">
        {TAGS.map((term) => (
          <Entry key={term.label} term={term} />
        ))}
      </dl>
      <h3>Numbers and labels</h3>
      <dl className="gloss-grid">
        {TERMS.map((term) => (
          <Entry key={term.label} term={term} />
        ))}
      </dl>
      <h3>Core requirement codes</h3>
      <p className="gloss-note">
        School of Arts and Sciences core codes, shown as blue chips on a course. Other schools add their own
        codes, such as CE or SOEHS; check that school&apos;s degree requirements for those.
      </p>
      <dl className="gloss-grid gloss-core">
        {CORE_CODES.map(([code, meaning]) => (
          <div className="gloss-entry" key={code}>
            <dt>
              <span className="chip chip-core">{code}</span>
            </dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
