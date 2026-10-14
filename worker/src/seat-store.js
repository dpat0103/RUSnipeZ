const iso = (value) => value == null ? null : new Date(value).toISOString();
export const MAX_GAP_MS = 90_000;

// One term per object. Events and summaries commit with the successful snapshot.
export class SeatStore {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1), term TEXT NOT NULL,
      started_at INTEGER, checked_at INTEGER, open_indexes TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS openings (
      section_index TEXT PRIMARY KEY, last_opened_at INTEGER NOT NULL,
      observed_after INTEGER NOT NULL, opening_count INTEGER NOT NULL)`);
    const columns = new Set(this.sql.exec("PRAGMA table_info(openings)").toArray().map((r) => r.name));
    for (const [name, type] of Object.entries({
      last_closed_at: "INTEGER", active_opened_at: "INTEGER",
      completed_openings: "INTEGER NOT NULL DEFAULT 0",
      total_duration_ms: "INTEGER NOT NULL DEFAULT 0", last_duration_ms: "INTEGER",
    })) {
      if (!columns.has(name)) this.sql.exec(`ALTER TABLE openings ADD COLUMN ${name} ${type}`);
    }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, section_index TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('opened', 'closed', 'gap')),
      observed_at INTEGER NOT NULL, observed_after INTEGER NOT NULL, duration_ms INTEGER)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS events_section_time ON events(section_index, observed_at)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS summary_chunks (chunk INTEGER PRIMARY KEY, payload TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS history_schema (version INTEGER PRIMARY KEY)");
    // Upgrade existing summaries without inventing past events.
    if (!this.sql.exec("SELECT version FROM history_schema WHERE version = 2").toArray().length) {
      storage.transactionSync(() => {
        this.updateChunks(this.sql.exec("SELECT section_index FROM openings").toArray().map((r) => r.section_index));
        this.sql.exec("INSERT INTO history_schema VALUES (2)");
      });
    }
  }

  initialize(term) {
    this.sql.exec(`INSERT OR IGNORE INTO snapshot VALUES (1, ?, NULL, NULL, '[]')`, term);
    if (this.meta().term !== term) throw new Error("History term mismatch");
  }

  meta() { return this.sql.exec("SELECT * FROM snapshot WHERE id = 1").toArray()[0]; }

  summary(row) {
    return {
      lastOpenedAt: iso(row.last_opened_at), observedAfter: iso(row.observed_after),
      openingCount: row.opening_count, lastClosedAt: iso(row.last_closed_at),
      completedOpenings: row.completed_openings,
      averageOpenSeconds: row.completed_openings
        ? Math.round(row.total_duration_ms / row.completed_openings / 1000) : null,
      lastOpenSeconds: row.last_duration_ms == null ? null : Math.round(row.last_duration_ms / 1000),
    };
  }

  updateChunks(indexes) {
    const chunks = new Map();
    for (const index of indexes) {
      const chunk = Math.floor(Number(index) / 1000);
      if (!chunks.has(chunk)) {
        const saved = this.sql.exec("SELECT payload FROM summary_chunks WHERE chunk = ?", chunk).toArray()[0];
        chunks.set(chunk, saved ? JSON.parse(saved.payload) : {});
      }
      const row = this.sql.exec("SELECT * FROM openings WHERE section_index = ?", index).toArray()[0];
      if (row) chunks.get(chunk)[index] = this.summary(row);
    }
    for (const [chunk, records] of chunks) {
      this.sql.exec(`INSERT INTO summary_chunks VALUES (?, ?)
        ON CONFLICT(chunk) DO UPDATE SET payload = excluded.payload`, chunk, JSON.stringify(records));
    }
  }

  record(indexes, now) {
    const meta = this.meta();
    if (meta.checked_at !== null && now <= meta.checked_at) return;
    const previous = new Set(JSON.parse(meta.open_indexes));
    const next = new Set(indexes);
    const continuous = meta.checked_at !== null && now - meta.checked_at <= MAX_GAP_MS;
    this.storage.transactionSync(() => {
      const changed = [];
      if (continuous) {
        for (const index of next) {
          if (previous.has(index)) continue;
          this.sql.exec(`INSERT INTO openings
            (section_index, last_opened_at, observed_after, opening_count, active_opened_at)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(section_index) DO UPDATE SET
              last_opened_at = excluded.last_opened_at, observed_after = excluded.observed_after,
              active_opened_at = excluded.active_opened_at, opening_count = opening_count + 1`,
              index, now, meta.checked_at, now);
          this.sql.exec(`INSERT INTO events (section_index, kind, observed_at, observed_after)
            VALUES (?, 'opened', ?, ?)`, index, now, meta.checked_at);
          changed.push(index);
        }
        for (const index of previous) {
          if (next.has(index)) continue;
          const row = this.sql.exec("SELECT * FROM openings WHERE section_index = ?", index).toArray()[0];
          const duration = row?.active_opened_at == null ? null : now - row.active_opened_at;
          this.sql.exec(`INSERT INTO events (section_index, kind, observed_at, observed_after, duration_ms)
            VALUES (?, 'closed', ?, ?, ?)`, index, now, meta.checked_at, duration);
          if (row) {
            this.sql.exec(`UPDATE openings SET last_closed_at = ?, active_opened_at = NULL,
              completed_openings = completed_openings + ?, total_duration_ms = total_duration_ms + ?,
              last_duration_ms = ? WHERE section_index = ?`,
              now, duration == null ? 0 : 1, duration ?? 0, duration, index);
            changed.push(index);
          }
        }
      } else if (meta.checked_at !== null) {
        this.sql.exec("INSERT INTO events (kind, observed_at, observed_after) VALUES ('gap', ?, ?)", now, meta.checked_at);
        // Durations crossing a gap are unknown, even if the section still looks open.
        this.sql.exec("UPDATE openings SET active_opened_at = NULL WHERE active_opened_at IS NOT NULL");
      }
      this.updateChunks(changed);
      this.sql.exec(`UPDATE snapshot SET started_at = COALESCE(started_at, ?),
        checked_at = ?, open_indexes = ? WHERE id = 1`, now, now, JSON.stringify([...next]));
    });
  }

  snapshot() {
    const meta = this.meta();
    // At most 100 compact rows instead of scanning every section every 30 seconds.
    const sections = Object.assign({}, ...this.sql.exec("SELECT payload FROM summary_chunks")
      .toArray().map((row) => JSON.parse(row.payload)));
    return {
      schemaVersion: 2, term: meta.term, startedAt: iso(meta.started_at), checkedAt: iso(meta.checked_at),
      openIndexes: JSON.parse(meta.open_indexes), sections,
    };
  }
}
