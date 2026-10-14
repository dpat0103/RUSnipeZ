export const SNAPSHOT_CACHE = "public, max-age=5, s-maxage=15, stale-while-revalidate=60";
export const snapshotKey = (term) => `snapshots/${term}.json`;
