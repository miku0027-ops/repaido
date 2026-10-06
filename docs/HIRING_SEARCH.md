# Hiring discovery reads and caching

Public category leaders and live hiring discovery use indexed worker and worker-job lookups instead of loading every worker and job on each request. Worker-funded offers are looked up by worker ID when a profile is built. SQLite has matching expression indexes; Firestore uses its automatic single-field indexes. Final hiring actions recheck availability against current records.

Public city-only leaderboard responses have an eight-second, per-process cache in production. The web app shares a 20-second, per-tab cache when a customer revisits a category and combines simultaneous requests. Both caches are bounded and expire; neither persists profiles in browser storage. GPS and live availability searches bypass the server cache. Browse results can take up to the cache lifetime to reflect changes.

A permanent Bloom filter is unsuitable for this search: it can return false positives, cannot rank candidates or calculate distances, and does not remove stale entries without rebuilding. Exact indexes and short-lived caches are used instead.

The current reads remove global job scans for ordinary city searches, but do not establish million-worker capacity. Strict cross-city nearby browsing still reads the full worker pool, and live hiring still reads all online workers before checking distance. Large city/category pools also require a dedicated search index or materialized candidate index. Before claiming million-user readiness, add that index, backfill existing workers, run representative load tests, and tune Cloud Run concurrency and autoscaling from measured latency and Firestore read costs.
