# Changelog

Notable changes to RU SnipeZ, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): patch releases only fix things, minor releases
add features. Each version is also a GitHub release with the same notes.

## [Unreleased]

### Added

- Weekly Dependabot PRs for the website's npm packages and GitHub Actions, a pull request
  template, this changelog, and pre-commit hooks that run ruff like CI does. (#34)

### Fixed

- Queued alerts are due at the time the opening was seen, not by the database's clock, so
  delivery no longer depends on the app and Postgres clocks agreeing. (#36, #37)

## [3.6.0] - 2026-11-15

### Added

- `/snipe` on a closed section shows when it was **last open** ("3 days ago"), or "No
  openings seen yet".
- `/check` adds `last open …` to each closed section.
- Same definition as `/lastopen` and the website, and the website's Discord preview shows it
  too. (#32, #33)

## [3.5.0] - 2026-11-15

### Added

- **#welcome** is a friendly start: what RU SnipeZ does, a three-step quick start, clickable
  links to the channels that matter, and buttons to the website.
- **#rules** holds six short server rules, ready to be the rules channel for Discord's
  Community features.
- **#how-to** walks through finding an index, `/snipe`, the alert and its buttons, turning
  DMs on, and managing your list, with a real screenshot for each step.
- **#wins** is where members share how they got in, one post every 6 hours.
- `deploy/discord/README.md` lists the Server Settings the owner sets by hand: Community,
  rules screening, onboarding, AutoMod and safety defaults.

### Changed

- `discord-setup` keeps channels in order and only edits a page when its content changes.
  (#30, #31)

## [3.4.0] - 2026-11-15

### Changed

- `#live-openings` logs every section as it opens, not only watched ones. Lines are packed
  into as few messages as fit, at most 5 per check, the last ending in "and N more" during
  a burst. (#28, #29)

## [3.3.1] - 2026-11-15

### Fixed

- New members no longer get Discord's default permissions. `discord-setup` trims @everyone
  to reading, chatting, reacting, links, attachments, slash commands and nicknames. (#26,
  #27)
- #general, #support and #feedback have 5 seconds of slow mode.

## [3.3.0] - 2026-11-09

### Added

- Nightly database dumps also go to a private Cloud Storage bucket: every night's dump for
  30 days, plus one per month kept indefinitely. The upload account cannot overwrite or
  delete dumps, and `deploy/status.sh` shows the last upload. (#24, #25)
- Each semester's openings, sections and catalogs are exported nightly as gzipped CSV and
  JSON under `archive/<term>/`.

### Fixed

- Live-page metrics are scoped to a semester, and feed dates no longer overlap with section
  indexes. (#23)

## [3.2.0] - 2026-10-24

### Added

- The Discord bot runs in the service, locked to the community server, with its layout
  applied from code. (#14)
- `/snipe`, `/check`, `/remove` and `/clear`; DM alerts with Register, Snooze, Stop watching
  and I got in; a private-thread fallback for closed DMs. (#16)
- `/lastopen`, `/course` and owner-only `/admin`; #live-openings, #status and #admin-log;
  alerts sent, check-to-DM time and "I got in" on the website. (#18)

## [3.1.0] - 2026-10-24

### Added

- Users, identities, watches and an alerts outbox. (#8)
- One watch service with a 15-per-term limit that holds under concurrent requests. (#10)
- Alerts are queued in the same transaction as each opening and sent by a dispatcher woken
  by PostgreSQL NOTIFY, with leases and retries. (#12)

## [3.0.0] - 2026-10-23

### Added

- The rewritten engine: polls Rutgers every 30 seconds per term, with a change guard
  against the stale snapshots Rutgers sometimes serves.
- Read API and website: live feed, search with seat history, How it works.
- Off-campus locations are synced and named; sections Rutgers has not listed yet are
  labeled.
- Runs on a GCP VM behind Caddy, with a budget kill switch, egress cap and nightly backups.

[Unreleased]: https://github.com/dpat0103/RUSnipeZ/compare/v3.6.0...HEAD
[3.6.0]: https://github.com/dpat0103/RUSnipeZ/compare/v3.5.0...v3.6.0
[3.5.0]: https://github.com/dpat0103/RUSnipeZ/compare/v3.4.0...v3.5.0
[3.4.0]: https://github.com/dpat0103/RUSnipeZ/compare/v3.3.1...v3.4.0
[3.3.1]: https://github.com/dpat0103/RUSnipeZ/compare/v3.3.0...v3.3.1
[3.3.0]: https://github.com/dpat0103/RUSnipeZ/compare/v3.2.0...v3.3.0
[3.2.0]: https://github.com/dpat0103/RUSnipeZ/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/dpat0103/RUSnipeZ/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/dpat0103/RUSnipeZ/releases/tag/v3.0.0
