# ApiDown: an API instance is unreachable

**Impact:** with one instance down, others take its traffic, which is slower. With all of them down, the apps, website and dashboard show errors.

1. **Is it one instance or all?** Look at the load balancer's targets, or run `docker compose ps` on the server.
2. **Look at what the API printed last:** `docker compose logs --tail 200 api`.
   - **"Invalid configuration"** at startup: the API refuses to start with bad settings (short secrets, the console SMS provider in production, missing Razorpay keys). Fix `.env` and run `docker compose up -d api`.
   - **Out of memory or a crash loop:** check `docker stats`. Restart with `docker compose restart api`.
3. **Check its dependencies:** `curl -s localhost:4000/ready`. It answers 503 until the database and Redis respond, and names what's down. See [database-down.md](database-down.md).
4. **Did it start right after a deploy?** [Roll back](rollback.md) first, then investigate.
5. **Done when** `/ready` answers 200 and the alert clears. Run `node scripts/ops/smoke.mjs --env production …` to confirm.
