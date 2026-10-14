import { SeatStore, MAX_GAP_MS } from "./seat-store.js";
import { snapshotKey, SNAPSHOT_CACHE } from "../../lib/snapshot-contract.js";
export { MAX_GAP_MS };
export { snapshotKey, SNAPSHOT_CACHE };
export const INTERVAL_MS = 30_000;

export function validateIndexes(value) {
  if (!Array.isArray(value) || value.some((i) => !/^\d{5}$/.test(String(i)))) {
    throw new Error("Invalid open-sections response");
  }
  return [...new Set(value.map(String))];
}

export class SeatHistory {
  constructor(ctx, env = {}) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => { this.store = new SeatStore(ctx.storage); });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const term = url.searchParams.get("term");
    if (!/^[0179]\d{4}$/.test(term ?? "")) return new Response("Invalid term", { status: 400 });
    await this.ctx.blockConcurrencyWhile(async () => {
      this.store.initialize(term);
      if (await this.ctx.storage.getAlarm() === null) {
        await this.ctx.storage.setAlarm(Date.now() + 1_000);
      }
    });
    if (url.pathname === "/arm") return new Response(null, { status: 204 });
    return Response.json(this.store.snapshot(), { headers: { "Cache-Control": "no-store" } });
  }

  record(indexes, now) { this.store.record(indexes, now); }

  async publish() {
    const payload = this.store.snapshot();
    if (!payload.checkedAt) return;
    if (!this.env.SNAPSHOTS) throw new Error("SNAPSHOTS bucket is not configured");
    await this.env.SNAPSHOTS.put(snapshotKey(payload.term), JSON.stringify(payload), {
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: SNAPSHOT_CACHE },
    });
  }

  async alarm() {
    const started = Date.now();
    const meta = this.store.meta();
    if (!(this.env.HISTORY_TERMS ?? "92026").split(",").map((s) => s.trim()).includes(meta.term)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    try {
      try {
        const url = new URL("https://classes.rutgers.edu/soc/api/openSections.json");
        url.search = new URLSearchParams({ year: meta.term.slice(1), term: meta.term[0], campus: "NB" });
        const response = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": "ru-snipez-history/2.0" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`Rutgers HTTP ${response.status}`);
        this.record(validateIndexes(await response.json()), Date.now());
      } catch (error) {
        console.error("History poll failed", error.message);
      }
      // Retry publication separately: failed uploads never lose committed events.
      try { await this.publish(); }
      catch (error) { console.error("Snapshot publication failed", error.message); }
    } finally {
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, started + INTERVAL_MS));
    }
  }
}
