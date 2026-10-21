import { useEffect, useRef, useState, type FormEvent } from "react";
import { DISCORD_INVITE } from "../lib/config";
import { useDemo } from "./context";
import { DiscordMessage } from "./DiscordMessage";
import { WATCH_LIMIT } from "./model";

const QUICK = ["/check", "/status", "/help", "/clear"];

/** The snipe list and bot conversation: what the Discord bot would show. */
export function DiscordPanel() {
  const demo = useDemo();
  const { watches, messages } = demo.state;
  const [draft, setDraft] = useState("");
  const thread = useRef<HTMLOListElement>(null);
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    const element = thread.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lastId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    void demo.run(draft);
    setDraft("");
  };

  return (
    <>
      <button className="demo-fab" onClick={() => demo.setPanelOpen(true)} aria-label="Open the Discord preview">
        Discord preview{watches.length ? ` · ${watches.length}` : ""}
      </button>

      <aside className="demo" data-open={demo.panelOpen || undefined} aria-label="Discord preview">
        <header className="demo-head">
          <div>
            <h2>Discord preview</h2>
            <p>Try the bot&apos;s commands. Resets when you close this tab.</p>
          </div>
          <button className="icon-button demo-close" onClick={() => demo.setPanelOpen(false)} aria-label="Close">
            ×
          </button>
        </header>

        <section className="demo-list" aria-label="Snipe list">
          <div className="demo-list-head">
            <h3>Snipe list</h3>
            <span>
              {watches.length}/{WATCH_LIMIT}
            </span>
          </div>
          {watches.length === 0 ? (
            <p className="demo-empty">Open a section and choose Snipe, or type /snipe and an index below.</p>
          ) : (
            <ul>
              {watches.map((watch) => {
                const open = demo.isOpen(watch);
                return (
                  <li key={`${watch.term}-${watch.index}`} className="demo-watch">
                    <span className="dc-dot" data-open={open === null ? undefined : String(open)} aria-hidden="true" />
                    <span className="demo-watch-name">
                      <strong>{watch.courseTitle}</strong>
                      <span>
                        Sec {watch.sectionNumber} · {watch.index} · {open === null ? "…" : open ? "Open" : "Closed"}
                        {watch.snoozedUntil && watch.snoozedUntil > Date.now() ? " · Snoozed" : ""}
                      </span>
                    </span>
                    <span className="demo-watch-actions">
                      <button onClick={() => void demo.lastopen(watch.index)} title={`/lastopen ${watch.index}`}>
                        History
                      </button>
                      <button onClick={() => demo.previewAlert(watch)} title="Show the alert DM">
                        Alert
                      </button>
                      <button
                        onClick={() => demo.remove(watch.index, watch.term)}
                        aria-label={`Remove ${watch.index}`}
                        title={`/remove ${watch.index}`}
                      >
                        ×
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <ol className="dc-thread" ref={thread} aria-label="Conversation with RU SnipeZ" aria-live="polite">
          {messages.length === 0 ? (
            <li className="dc-welcome">
              <strong>This is how RU SnipeZ works on Discord.</strong> Snipe a section from the search
              results, or type a command such as <code>/help</code>.
            </li>
          ) : (
            messages.map((message) => <DiscordMessage key={message.id} message={message} />)
          )}
        </ol>

        <form className="dc-composer" onSubmit={submit}>
          <div className="dc-quick">
            {QUICK.map((command) => (
              <button type="button" key={command} onClick={() => void demo.run(command)}>
                {command}
              </button>
            ))}
          </div>
          <label>
            <span className="visually-hidden">Command</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a command, like /snipe 12345"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </form>

        <footer className="demo-foot">
          {DISCORD_INVITE ? (
            <a href={DISCORD_INVITE}>Get real alerts in the Discord server</a>
          ) : (
            <span>Real alerts come from the Discord bot. Invite link coming soon.</span>
          )}
          {(watches.length > 0 || messages.length > 0) && (
            <button className="link-button" onClick={demo.reset}>
              Reset
            </button>
          )}
        </footer>
      </aside>
    </>
  );
}
