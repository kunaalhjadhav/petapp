# Restore the database

**Targets:**
- **RPO** (data you can lose) 5 minutes, with the managed database's point-in-time recovery.
- **RTO** (time to be back) 1 hour.

## Choose the source
1. **Point-in-time recovery** of the managed database: the first choice, to any second in the retention window.
2. **PetApp's own logical backup** (`node scripts/ops/backup.mjs`, nightly to `BACKUP_BUCKET`, in another account or region). Use it when the managed snapshots are unusable or the cloud account itself is the problem.

## Steps
1. **Agree the restore point with the person in charge.** Everything after it is lost from the database. Payments are recovered from the gateway (step 6).
2. **Stop writes:** scale the API and worker to zero (`docker compose stop api worker`). Show a maintenance message if your load balancer supports one.
3. **Restore into a new instance.** Never restore over the damaged one: keep it for investigation.
   - **Point in time:** use the provider's console.
   - **Logical backup:** create an empty database on the new instance, then run
     `pg_restore --no-owner --no-acl --exit-on-error --dbname <new url> <file>`.
     If `BACKUP_ENCRYPTION_KEY` was set, decrypt the file first: `restore-drill.mjs --keep` downloads, checks and restores a backup into a scratch database you can promote.
4. **Bring the schema up to date:** run `npm run db:deploy` (or `docker compose run --rm migrate`) against the new database.
5. **Point `DATABASE_URL` at it** and start the API and worker.
6. **Recover what happened after the restore point:**
   - Run a reconciliation (dashboard → Finance → Reconciliation). It compares payments and refunds with the gateway and lists what the restored database is missing; press **Recover payment** next to each listed capture.
   - Check the audit log for staff actions after the restore point, and repeat the ones that matter.
7. **Smoke test** with `node scripts/ops/smoke.mjs --env production …`, then reopen.

## Quarterly drill
Run `node scripts/ops/restore-drill.mjs --report drill.json` against a restore instance. It:
- downloads the latest backup and checks its checksum
- restores it into a scratch database
- checks every table's row count, the ledger totals, and that each ledger transaction balances
- checks the database safeguards (triggers and unique rules) and the migrations
- times it all

Keep the report, and note the time against the RTO. CI runs the same drill on a fresh database on every push.
