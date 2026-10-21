import { Link } from "react-router";
import { DISCORD_INVITE } from "../lib/config";

export function DiscordCta({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`cta${compact ? " cta-compact" : ""}`} aria-labelledby="cta-title">
      <div>
        <h2 id="cta-title">Get alerts on Discord</h2>
        <p>
          Watch a section with <code>/snipe</code> and RU SnipeZ sends you a direct message the moment
          a seat opens, with a WebReg link that has the index filled in. Free for Rutgers students.
        </p>
      </div>
      <div className="cta-actions">
        <Link className="button" to="/search">
          Try the Discord preview
        </Link>
        {DISCORD_INVITE ? (
          <a className="button button-primary" href={DISCORD_INVITE}>
            Join the Discord
          </a>
        ) : (
          <span className="button button-muted" aria-disabled="true">
            Discord invite coming soon
          </span>
        )}
      </div>
    </section>
  );
}
