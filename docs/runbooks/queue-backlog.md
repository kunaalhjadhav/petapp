# QueueBacklog: over 500 jobs waiting for 15 minutes

1. **System health** shows each queue's waiting, running and failed jobs.
2. **Is the worker running and busy?** See [worker-down.md](worker-down.md). A healthy, busy worker means it needs more capacity: run another worker container (`docker compose up -d --scale worker=2`), or raise `MEDIA_CONCURRENCY` / `NOTIFY_CONCURRENCY`.
3. **Media queue:** video transcoding is the slowest work. A burst of reel uploads is normal after a contest opens.
4. **One stuck job:** the same job id stays "running" for a long time. Restart the worker; BullMQ retries stalled jobs.
