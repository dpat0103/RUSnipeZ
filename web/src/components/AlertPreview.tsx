import { useEffect, useRef } from "react";
import type { CatalogCourse, CatalogSection } from "../api/types";
import { DISCORD_INVITE, webregUrl } from "../lib/config";
import { meetingSummary } from "../lib/format";

interface Props {
  term: string;
  termName: string;
  course: CatalogCourse;
  section: CatalogSection;
  onClose: () => void;
}

/** What the Discord bot sends when a watched section opens. */
export function AlertPreview({ term, termName, course, section, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="alert-preview-title"
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && dialog.current?.close()}
    >
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id="alert-preview-title">This is the alert you would get</h2>
          <button className="icon-button" onClick={() => dialog.current?.close()} aria-label="Close">
            ×
          </button>
        </div>

        <div className="discord" aria-label="Example Discord message">
          <img className="discord-avatar" src="/logo.png" alt="" width={40} height={40} />
          <div className="discord-message">
            <div className="discord-author">
              RU SnipeZ <span className="discord-app">APP</span>
            </div>
            <div className="discord-embed">
              <strong className="discord-title">{course.title} is open</strong>
              <dl>
                <dt>Index</dt>
                <dd>{section.index}</dd>
                <dt>Section</dt>
                <dd>
                  {section.number} · {course.code}
                </dd>
                <dt>Instructor</dt>
                <dd>{section.instructors.join(", ") || "TBA"}</dd>
                <dt>Meets</dt>
                <dd>{meetingSummary(section.meets)}</dd>
                {section.spn && (
                  <>
                    <dt>Heads up</dt>
                    <dd>Needs a special permission number from the department</dd>
                  </>
                )}
              </dl>
              <span className="discord-footer">{termName}</span>
            </div>
            <a className="discord-button" href={webregUrl(term, section.index)} target="_blank" rel="noreferrer">
              Register
            </a>
          </div>
        </div>

        <p>
          In the Discord server, run <code>/snipe {section.index}</code>. The Register button opens
          WebReg with this index filled in; you sign in yourself, and RU SnipeZ never sees your NetID.
        </p>
        {DISCORD_INVITE ? (
          <a className="button button-primary" href={DISCORD_INVITE}>
            Join the Discord
          </a>
        ) : (
          <p className="muted">The Discord invite link is coming soon.</p>
        )}
      </div>
    </dialog>
  );
}
