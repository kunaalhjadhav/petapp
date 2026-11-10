# Roll back to the previous release

Migrations are always backward-compatible (expand, then contract), so the previous version runs against the new schema. Rolling back never needs a database change.

**Fastest, on the server:**

```bash
cd <deploy path>
PREV=<the previous tag>   # the tag before $(cat .deployed-tag); the deploy workflow's history lists them
IMAGE_TAG=$PREV DEPLOY_ENV=production docker compose -f compose.yml up -d api worker admin web
echo $PREV > .deployed-tag
```

**Or from GitHub:** **Actions → deploy → Run workflow**, with `ref` set to the previous commit. It goes through staging and the production approval again.

- **Mobile apps** can't be rolled back. Release a fixed build, or switch the broken feature off in the dashboard.
- **A bad migration** (data changed wrongly, not just new columns) needs a restore: see [restore-database.md](restore-database.md). Never edit production data by hand.
