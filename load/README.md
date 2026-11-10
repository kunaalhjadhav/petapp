# Load tests

`petapp.js` is a [k6](https://k6.io) script that sends two kinds of traffic at once:
- **browse:** people and crawlers opening shared links without signing in. Pets, posts, products, product search, service partners, nearby services, contests and the trending feed.
- **member:** signed-in people. Home, feed, notifications, profile, cart, a contest and product picks.

It passes when, under the chosen load:
- fewer than 1% of requests fail
- browse requests answer within 400 ms (95th percentile) and 1 s (99th)
- member requests answer within 500 ms and 1.2 s
- no single endpoint takes more than 1.5 s at the 95th percentile

## Run it

Run against **staging**, never production. Set `RATE_LIMIT_MULTIPLIER=100` on the staging API first: all the traffic comes from one machine, which the normal rate limits would block. The API refuses this setting in production.

```powershell
winget install k6 --source winget
k6 run load/petapp.js                                                        # local API, 20 req/s browse + 10 member
k6 run -e BASE_URL=https://api.staging.petapp.in -e RATE=100 -e DURATION=10m load/petapp.js
k6 run -e RATE=100 --summary-export results.json load/petapp.js              # keep the numbers
```

**Options:**
- `RATE`: browse requests a second; member traffic runs at half of it.
- `DURATION`
- `USERS`: signed-in accounts created for the run, as `load-<run>-<n>@petapp.test`.
- `LAT` and `LNG`: where "nearby" is.

Staging should be the same size as production for the numbers to mean anything.

See `RESULTS.md` for the last measured run.
