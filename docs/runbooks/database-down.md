# DatabaseDown: the API can't reach PostgreSQL

**Impact:** the API answers 503 to almost everything. Nothing is written, so nothing is half-done: payments are confirmed again from the gateway once the database is back (webhooks retry, and reconciliation runs nightly).

1. **Check the managed database's console:** status, CPU, storage, connections, maintenance events.
2. **Storage full:** grow the volume. Then find what grew; it's usually media rows or the audit log.
3. **Too many connections:** each API and worker process opens a pool. Count processes × pool size against the database's connection limit. Restart crashed processes that leaked connections.
4. **Failed over:** the endpoint name stays the same on managed services. The API reconnects by itself; restart it if it doesn't within a few minutes.
5. **The data is damaged or lost:** stop and follow [restore-database.md](restore-database.md). Decide the restore point with the person in charge before acting.
6. **After it's back:**
   - Run a reconciliation (dashboard → Finance → Reconciliation → Run now). It lists any payment the gateway captured that we didn't confirm while the API was down; press **Recover payment** next to each one on that page.
   - Check **System health**.
