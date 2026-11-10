# SlowApi: 95th-percentile response time is over 1 second

1. **Which routes?** Look at `petapp_http_request_duration_seconds` by route.
2. **Everything is slow:**
   - Check CPU on the API processes. One process handles about 100 requests a second (`load/RESULTS.md`). Add instances.
   - If the API isn't busy, check the database's CPU and slow-query log.
3. **One route:** look for a missing index, or a big page size. The home screen and product picks have caches (two minutes); a Redis outage makes them slow.
4. **Photo-heavy routes:** if `MEDIA_PUBLIC_BASE_URL` isn't set, every photo URL is signed per request, which is CPU-heavy. Set it to the CDN.
5. **Afterwards:** add the slow route to `load/petapp.js` if it isn't there, and re-run the load test on staging.
