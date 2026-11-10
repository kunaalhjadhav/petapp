# Load test results

## Setup
- **Measured:** 18 October 2026, with `load/petapp.js`.
- **The machine:** one 2-vCPU, 8 GB machine running everything — one API process, PostgreSQL 16, Redis and S3-compatible storage — plus k6 itself. A production setup spreads these across machines, so these numbers are a floor.
- **Settings:** `MEDIA_PUBLIC_BASE_URL` set (CDN-style photo links, as in production), `LOG_LEVEL=warn`, `RATE_LIMIT_MULTIPLIER=200`.

## Results

| Load (requests a second) | Failed | Browse p95 / p99 | Member p95 / p99 | Slowest endpoint (p95) | Thresholds |
|---|---|---|---|---|---|
| 84 (60 browse + 30 member, 90 s) | 0% | 20 / 73 ms | 53 / 178 ms | `/home` 74 ms | Pass |
| 140 (100 browse + 50 member, 90 s) | 0% | 53 / 94 ms | 134 / 316 ms | `/home` 298 ms | Pass |
| 225 offered (150 + 75) | 0% | queueing | queueing | — | Fail: the API process saturates at about 115–140 requests a second here |

Other endpoints at 140 requests a second (p95):

| Endpoint | p95 |
|---|---|
| `/recommendations/products` | 130 ms |
| `/feed` | 91 ms |
| `/products/:slug` | 63 ms |
| `/services/nearby` | 60 ms |

## What the profile showed, and what changed
- **Product recommendations were re-ranked on every home screen.** That ranking reads purchase, booking and viewing history. It's now cached for two minutes per person, or per species when signed out. Prices and stock are still read fresh, and the cache is cleared when someone hides a product, clears their history or switches personalisation.
- **Signing photo links costs about 5% of the API's CPU** when `MEDIA_PUBLIC_BASE_URL` isn't set, because every photo URL is signed per request. Production must set it to the CDN; it also keeps share previews working.
- **Password hashing (bcrypt) is CPU-heavy by design.** A burst of email sign-ins takes CPU from everything else in that process. Phone OTP sign-in, the main way in, doesn't hash.
- **When saturated, the single API process is the limit, not the database:** Node used 100% of one CPU while Postgres used under 10%.

## Sizing advice
- **Plan on about 100 requests a second per API process** (one vCPU) with headroom, and run at least two for availability.
- **Scale by adding processes behind the load balancer.** The API holds no state.
- **Re-run this test on staging after big releases,** at your expected peak times two.
