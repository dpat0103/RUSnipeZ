import { NavLink, Outlet, useSearchParams } from "react-router";
import { useMeta } from "../api/hooks";
import { DISCORD_INVITE, GITHUB_URL } from "../lib/config";
import { useTerm } from "../lib/hooks";
import { LiveStatus } from "./LiveStatus";

const NAV = [
  { to: "/", label: "Live" },
  { to: "/search", label: "Search" },
  { to: "/how-it-works", label: "How it works" },
];

export function Layout() {
  const meta = useMeta();
  const { term, info, terms, setTerm } = useTerm();
  const [params] = useSearchParams();
  // Keep the chosen term when moving between pages.
  const termQuery = params.get("term") ? `?term=${params.get("term")}` : "";

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <NavLink to={{ pathname: "/", search: termQuery }} className="brand">
            <img src="/logo.png" alt="" width={32} height={32} />
            <span>RU SnipeZ</span>
          </NavLink>
          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={{ pathname: item.to, search: termQuery }} end>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-end">
            {terms.length > 1 && term && (
              <label className="term-select">
                <span className="visually-hidden">Term</span>
                <select value={term} onChange={(e) => setTerm(e.target.value)}>
                  {terms.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name ?? t.code}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <LiveStatus lastPollAt={meta.data ? (info?.lastPollAt ?? null) : undefined} error={meta.isError} />
          </div>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="footer">
        <span>
          Data from the Rutgers Schedule of Classes. Not affiliated with Rutgers University.
        </span>
        <span className="footer-links">
          {DISCORD_INVITE && <a href={DISCORD_INVITE}>Discord</a>}
          <a href={GITHUB_URL}>GitHub</a>
          <a href="/api/docs">API</a>
        </span>
      </footer>
    </div>
  );
}
