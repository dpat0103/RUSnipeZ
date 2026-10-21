import { useMeta } from "../api/hooks";
import { DiscordCta } from "../components/DiscordCta";
import { GITHUB_URL } from "../lib/config";

const PIPELINE = [
  ["Rutgers API", "openSections.json lists every open section index."],
  ["Poller", "One request per term every 30 seconds, for every user at once."],
  ["Diff", "Compare with the last check. Only new indexes are openings."],
  ["Guard", "Hold suspicious mass changes until they last 2 minutes."],
  ["PostgreSQL", "Store each opening and closing with its time window."],
  ["Discord + this site", "Alert watchers; publish the feed and history."],
] as const;

export function HowPage() {
  const meta = useMeta();
  const poll = meta.data?.pollSeconds ?? 30;

  return (
    <article className="prose">
      <h1>How it works</h1>

      <h2>The problem</h2>
      <p>
        Popular Rutgers sections fill in the first hours of registration, and most have no
        waitlist. When a student drops, the seat goes to whoever refreshes WebReg first. RU SnipeZ
        does the refreshing and tells you when to act.
      </p>

      <h2>Detecting an opening</h2>
      <ol className="pipeline">
        {PIPELINE.map(([name, text]) => (
          <li key={name}>
            <strong>{name}</strong>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <p>
        Rutgers publishes the list of open sections, cached for {poll} seconds. Checking faster
        cannot return newer data, so one shared check every {poll} seconds is as fast as any tool
        can be, and lighter on Rutgers than every student refreshing.
      </p>
      <p>
        An opening is a section that appears in the list when it was missing from the previous
        check. A section that stays open is not news, so nobody gets the same alert twice.
      </p>

      <h2>Bad data from upstream</h2>
      <p>
        Rutgers&apos; endpoint sometimes serves an out-of-date list for about a minute. In one case
        4,308 sections disappeared and came back. Treated as real, that would have meant thousands
        of false alerts. Any check that changes many sections at once is held until the change has
        lasted two minutes; if the list recovers first, nothing is recorded.
      </p>

      <h2>What the history means</h2>
      <ul>
        <li>
          <strong>Seen open</strong> is the last check that found the section open. Times are
          accurate to about {poll} seconds.
        </li>
        <li>
          A seat that opens and fills between two checks is not seen, so the history undercounts
          the shortest openings.
        </li>
        <li>
          Sections already open when tracking began have no known opening time and are not counted
          as openings.
        </li>
      </ul>

      <h2>What it never does</h2>
      <p>
        RU SnipeZ never asks for your NetID and never registers for you. The alert links to WebReg
        with the index filled in, and you sign in yourself.
      </p>

      <h2>Built with</h2>
      <p>
        Python, FastAPI, PostgreSQL and SQLAlchemy on the server; React and TypeScript here. The
        API is public and documented at <a href="/api/docs">/api/docs</a>, and the source is on{" "}
        <a href={GITHUB_URL}>GitHub</a>.
      </p>

      <DiscordCta compact />
    </article>
  );
}
