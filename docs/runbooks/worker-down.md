# WorkerDown: background jobs aren't running

**Impact:** none of these are lost (they wait in Redis or the database), but they are delayed:
- photos and videos stay "processing"
- notifications aren't sent
- refunds and payouts wait
- nightly jobs (reconciliation, privacy purges, account erasure) don't run

1. `docker compose ps worker` and `docker compose logs --tail 200 worker`.
2. **Its own health:** `curl -s localhost:9464/health`.
3. **Restart it:** `docker compose up -d worker`. Jobs resume from where they were.
4. **If it keeps crashing on one job:** the log names the queue and job. Pause that work in the dashboard where possible (for example, turn off the feature switch), then fix forward.
5. **Afterwards,** check **System health**: the queues should be draining.
