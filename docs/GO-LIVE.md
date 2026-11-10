# Going live, step by step

This guide takes PetApp from the zip to a live site: code on GitHub, a server running the API, worker, admin dashboard and website, and a live managed database.

- **Your own PC:** the commands are for Windows PowerShell.
- **The server:** it runs Linux, so commands typed there after `ssh` are Linux commands. Each block says which one it is.
- **Example names:** the example provider is DigitalOcean's Bangalore region (BLR1), and the example domain is `yourdomain.in`. Replace both with your own. AWS (Mumbai, `ap-south-1`) works the same way; the differences are noted.

```
                    ┌────────────── Ubuntu server (Docker) ──────────────┐
 yourdomain.in ───► │ Caddy (HTTPS) ─► web :3001     (public website)    │
 admin.… ─────────► │               ─► admin :3000   (admin dashboard)   │
 api.… (apps) ────► │               ─► api :4000  +  worker (video, jobs)│
                    └──────┬──────────────┬──────────────┬───────────────┘
                 Managed PostgreSQL   Managed Redis   Object storage (S3 API)
                 16 + PostGIS         (Valkey)        media + backups
```

GitHub builds the Docker images and deploys them over SSH. You never build on the server.

---

## 1. On your PC: install the tools

```powershell
winget install Git.Git OpenJS.NodeJS.LTS Docker.DockerDesktop GitHub.cli
# Close and reopen PowerShell, then check:
git --version; node --version; docker --version; gh --version
```

Run the project locally once, following "Quick start — Windows" in `README.md`. That proves your copy works before you pay for servers.

## 2. Put the code on GitHub (private)

```powershell
cd D:\PetApp\petapp            # wherever you unzipped it
git init -b main
git add .
git status                     # .env must NOT be listed (it's in .gitignore). prod.env must never be committed either.
git commit -m "PetApp final release"
gh auth login                  # choose GitHub.com, HTTPS, log in with the browser
gh repo create petapp --private --source . --push
```

Pushing starts **CI** (GitHub → your repo → **Actions**). It runs all the tests, including compiling the three Flutter apps. That is the first time the apps are compiled, so look at the result. You can deploy even if a Flutter job fails (step 9 runs the deploy by hand), but fix it before you build store releases.

## 3. Create the cloud resources

On DigitalOcean (cloud.digitalocean.com), create everything in the same region (**BLR1**) and the same VPC (private network).

1. **Droplet (the server):**
   - **Image:** Ubuntu 24.04.
   - **Size:** at least 4 GB RAM and 2 vCPUs. The worker transcodes videos; choose 8 GB if many people will post reels.
   - **SSH key:** create one on your PC with `ssh-keygen -t ed25519 -C "you@yourdomain.in"` (press Enter at each question), then paste the contents of `$HOME\.ssh\id_ed25519.pub` into DigitalOcean.
   - **Backups:** turn on weekly droplet backups.
   - Note the droplet's **public IP**.
2. **Database:** Databases → Create → **PostgreSQL 16**.
   - **Size:** start with at least 2 GB RAM.
   - **Users & Databases:** add the user `petapp` and the database `petapp`.
   - **Settings → Trusted sources:** add the droplet only.
   - **Connection details:**
     - Choose **VPC network** and copy the connection string for the user `petapp` and the database `petapp`. It starts with `postgresql://petapp:…@private-…`.
     - Also copy the `doadmin` connection string; you need it once, in step 4.
     - **Download the CA certificate** (`ca-certificate.crt`).
3. **Redis:** Databases → Create → **Valkey** (Redis-compatible), the same region and VPC.
   - **Trusted sources:** the droplet only.
   - **Connection:** copy the **VPC** connection string. It starts with `rediss://default:…@private-…`. If a CA certificate is offered, download it too.
4. **Object storage:** Spaces Object Storage → Create, in **BLR1**.
   - **Buckets:** create two:
     - `yourname-petapp-media`, with **CDN enabled**. Note its CDN endpoint, `https://yourname-petapp-media.blr1.cdn.digitaloceanspaces.com`.
     - `yourname-petapp-backups`, with **no CDN** and kept private.
   - **Access key:** Spaces → Access Keys → create one with read/write on both buckets. Note the key and the secret.
   - **Make only processed media public.** The `media/` folder is public; `uploads/` (originals) and `exports/` (people's data downloads) stay private. Run this on your PC:

     ```powershell
     winget install Amazon.AWSCLI          # then reopen PowerShell
     aws configure set aws_access_key_id <SPACES_KEY>
     aws configure set aws_secret_access_key <SPACES_SECRET>
     @'
     {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::yourname-petapp-media/media/*"}]}
     '@ | Set-Content -Encoding ascii media-policy.json
     aws s3api put-bucket-policy --bucket yourname-petapp-media --policy file://media-policy.json --endpoint-url https://blr1.digitaloceanspaces.com --region us-east-1
     ```

     If Spaces refuses the policy, use AWS S3 for storage instead. The settings in step 6 are the same, with `S3_ENDPOINT` left empty and the AWS region.

**On AWS instead:**

| DigitalOcean | AWS equivalent |
|---|---|
| Droplet | EC2 (Ubuntu 24.04, t3.medium or larger) |
| Managed PostgreSQL | RDS PostgreSQL 16; the CA is AWS's `global-bundle.pem` |
| Valkey | ElastiCache (Valkey or Redis) with in-transit encryption |
| Spaces | S3 with CloudFront in front of the media bucket |

Keep everything in `ap-south-1`.

## 4. Prepare the live database (once)

The migrations create the PostGIS, pg_trgm and btree_gist extensions. On a managed database only the admin user may create them, so create them first as `doadmin` and give `petapp` the schema. Run this from the server once you've done step 5, or from any machine the database trusts:

```bash
# On the server (Linux), after step 5:
docker run --rm -it postgres:16 psql "postgresql://doadmin:<PASSWORD>@private-<HOST>:25060/petapp?sslmode=require"
```

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER DATABASE petapp OWNER TO petapp;   -- if refused: GRANT ALL ON SCHEMA public TO petapp;
\q
```

The tables are created by the first deploy (step 9); the first admin comes in step 10.

## 5. Prepare the server (once)

**On your PC:** make the key GitHub will use to deploy, then log in.

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\petapp_deploy -C "github-deploy"     # press Enter twice: no passphrase
ssh root@<DROPLET_IP>
```

**On the server (Linux), as root:**

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh                     # Docker + Compose v2
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /opt/petapp && chown deploy:deploy /opt/petapp
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# Caddy: HTTPS certificates are automatic, and WebSockets for chat pass straight through
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
cat > /etc/caddy/Caddyfile <<'EOF'
yourdomain.in, www.yourdomain.in {
  reverse_proxy 127.0.0.1:3001
}
admin.yourdomain.in {
  reverse_proxy 127.0.0.1:3000
}
api.yourdomain.in {
  request_body {
    max_size 20MB
  }
  reverse_proxy 127.0.0.1:4000
}
EOF
systemctl reload caddy
exit
```

**Back on your PC:** allow the deploy key on the server.

```powershell
Get-Content $HOME\.ssh\petapp_deploy.pub | ssh root@<DROPLET_IP> "mkdir -p /home/deploy/.ssh && cat >> /home/deploy/.ssh/authorized_keys && chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys"
ssh -i $HOME\.ssh\petapp_deploy deploy@<DROPLET_IP> "docker ps"      # must work without a password
```

Video and photo uploads go straight from the apps to storage, so the 20 MB API limit is ample.

## 6. Write the production settings (`prod.env`)

**On your PC**, in the project folder:

```powershell
Copy-Item .env.example prod.env
# Secrets: run each line once per value you need
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, OTP_PEPPER, METRICS_TOKEN
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # PAYOUT_DATA_KEY, MFA_DATA_KEY, BACKUP_ENCRYPTION_KEY (three different ones)
# The database CA certificate, as one line:
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\ca-certificate.crt"))
notepad prod.env
```

Set these in `prod.env`. Everything not listed can stay as it is in the template.

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` (Caddy is in front) |
| `CORS_ORIGINS` | `https://admin.yourdomain.in,https://yourdomain.in` |
| `SWAGGER_ENABLED` | `false` |
| `DATABASE_URL` | the **VPC** string for `petapp`, ending in `?sslmode=require` |
| `DATABASE_CA_CERT` | the one-line base64 from above |
| `REDIS_URL` | the **VPC** `rediss://…` string |
| `REDIS_CA_CERT` | the base64 of the Redis CA certificate, if one was offered |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_PEPPER` | three different generated secrets |
| `SMS_PROVIDER` | `smslocal`, with `SMSLOCAL_*` and your DLT template and entity ids |
| `EMAIL_PROVIDER` | `smtp`, with `SMTP_*` and `EMAIL_FROM` (or `none` until you have email) |
| `DASHBOARD_URL` | `https://admin.yourdomain.in` |
| `S3_ENDPOINT` | `https://blr1.digitaloceanspaces.com` (empty on AWS) |
| `S3_REGION` | `us-east-1` for Spaces (the endpoint picks the real region); `ap-south-1` on AWS |
| `S3_BUCKET` | `yourname-petapp-media` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the Spaces key |
| `S3_FORCE_PATH_STYLE` | `false` |
| `MEDIA_PUBLIC_BASE_URL` | the media bucket's CDN endpoint |
| `PAYMENT_PROVIDER` | `razorpay`, with `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` (live keys) |
| `PAYOUT_PROVIDER` | `razorpayx`, with the `RAZORPAYX_*` settings |
| `PAYOUT_DATA_KEY`, `MFA_DATA_KEY` | two generated 32-byte keys. **Back them up somewhere safe**: losing them makes bank details and two-factor secrets unreadable. |
| `BACKUP_BUCKET` | `yourname-petapp-backups` |
| `BACKUP_ENCRYPTION_KEY` | the third generated 32-byte key |
| `METRICS_TOKEN` | a generated secret |
| `SITE_URL` | `https://yourdomain.in` |
| `SITE_INDEXABLE` | `true` |
| `SUPPORT_EMAIL` | your support address |
| `PUSH_PROVIDER` | `fcm`, with `FCM_*` (or `none` for now) |
| `AI_PROVIDER` | `rules`, or `anthropic` with `ANTHROPIC_API_KEY` |
| `MAP_PROVIDER` | `none`, or `google` with `GOOGLE_MAPS_KEY` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | your admin login (12+ characters), only until step 10 |
| `SEED_DEMO_DATA` | `false` |

**Production won't start with test providers.** The API refuses console SMS, console email, fake payments, fake payouts and missing `PAYOUT_DATA_KEY` or `MFA_DATA_KEY`, so you need live Razorpay, RazorpayX and SMSLocal accounts first. To try the server before those accounts are ready, set `NODE_ENV=development` with the console and fake providers, and keep the addresses to yourself. Anyone could "pay" for free in that mode.

Check the file, then copy it to the server:

```powershell
node scripts/ops/preflight.mjs --env-file prod.env          # FAIL lines must be fixed; WARN lines are worth a look
scp -i $HOME\.ssh\petapp_deploy prod.env deploy@<DROPLET_IP>:/opt/petapp/.env
ssh -i $HOME\.ssh\petapp_deploy deploy@<DROPLET_IP> "chmod 600 /opt/petapp/.env"
```

Keep `prod.env` out of Git, and store it in a password manager.

## 7. Point your domain at the server

At your domain registrar (GoDaddy, Hostinger, Cloudflare…), add **A records** to the droplet's IP for `@`, `www`, `admin` and `api`. Check them:

```powershell
Resolve-DnsName api.yourdomain.in
```

Caddy fetches the HTTPS certificates by itself once the names point at the server.

## 8. Connect GitHub to the server

Go to your repo → **Settings**.

1. **Environments → New environment → `production`:**
   - **Required reviewers:** add yourself. Every production deploy then waits for your click.
   - **Environment secrets:**

     | Secret | Value |
     |---|---|
     | `DEPLOY_HOST` | the droplet IP |
     | `DEPLOY_USER` | `deploy` |
     | `DEPLOY_PATH` | `/opt/petapp` |
     | `DEPLOY_SSH_KEY` | the private key. Copy it with `Get-Content $HOME\.ssh\petapp_deploy -Raw \| Set-Clipboard` and paste. |

   - **Environment variables:**

     | Variable | Value |
     |---|---|
     | `API_URL` | `https://api.yourdomain.in` |
     | `WEB_URL` | `https://yourdomain.in` |
     | `ADMIN_URL` | `https://admin.yourdomain.in` |

2. **Secrets and variables → Actions → Variables (repository):**
   - `SKIP_STAGING` = `true`. With one server there is no staging yet. When you add a staging server later, create a `staging` environment the same way and delete this variable.
   - `API_BASE_URL` = `https://api.yourdomain.in` and `SHARE_DOMAIN` = `yourdomain.in`, for the app builds in step 12.

## 9. Deploy

Go to **Actions → deploy → Run workflow → Run**. After this first time, every push to `main` that passes CI deploys by itself.

1. **Images:** the build job pushes the images to GitHub's registry (about 10 minutes the first time).
2. **Approve:** the production job waits for you. Click **Review deployments → Approve**.
3. **On the server,** `deploy.sh` then:
   - backs up the database
   - runs the migrations, which create all the tables
   - starts the containers
   - waits until they're healthy, and rolls back on its own if they're not
4. **The smoke test** checks the live addresses.

Check it yourself:

```powershell
curl.exe https://api.yourdomain.in/ready          # database, redis and storage should all be "ok"
start https://yourdomain.in
start https://admin.yourdomain.in
```

## 10. Create the first admin and the base data (once)

**On the server (Linux):**

```bash
ssh -i ~/.ssh/petapp_deploy deploy@<DROPLET_IP>      # (from PowerShell: ssh -i $HOME\.ssh\petapp_deploy deploy@<DROPLET_IP>)
cd /opt/petapp
export IMAGE_TAG=$(cat .deployed-tag) DEPLOY_ENV=production REGISTRY=ghcr.io/<your-github-name-in-lowercase>/petapp
docker compose -f compose.yml --profile jobs run --rm migrate npx prisma db seed
```

The seed creates the roles and permissions, the pet species, the feature switches, India's states and cities, and your super admin. It is safe to run again later.

Then remove the seed password from the server, and restart so nothing holds it:

```bash
sed -i 's/^SEED_ADMIN_PASSWORD=.*/SEED_ADMIN_PASSWORD=/' .env
docker compose -f compose.yml up -d api worker admin web
```

Now go to `https://admin.yourdomain.in`, sign in, and:

1. **Your account:**
   - Change your password.
   - Set up **two-factor sign-in**, and keep the recovery codes.
2. **Settings:**
   - **Company:** the legal name, GSTIN, PAN and address for invoices.
   - **Money:** tax rates and commissions (check them with your accountant).
   - **Security:** turn on `security.requireStaffMfa` once your staff have two-factor.
3. **Legal:** publish the terms, privacy policy and contest rules.
4. **Locations:** import your cities' areas and PIN codes (CSV). Turn on services city by city.
5. **Feature switches:** turn on the parts you're launching (reels, contests, services, shop…).
6. **People:** invite your staff with the right roles.

## 11. Connect the outside services

| Service | What to set up |
|---|---|
| **Razorpay** | Dashboard → Webhooks: `https://api.yourdomain.in/api/v1/webhooks/payments`, with the events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed` and `refund.failed`. Its secret is `RAZORPAY_WEBHOOK_SECRET`. |
| **RazorpayX** | Webhook: `https://api.yourdomain.in/api/v1/webhooks/payouts`, with `payout.*` and `fund_account.validation.*`. |
| **SMSLocal** | The DLT template text must match `OTP_MESSAGE_TEMPLATE` exactly. Test by signing in to the app with your phone. |
| **Email** | Add the SPF and DKIM records your SMTP provider gives you. Test with **Forgot your password?** on the dashboard. |
| **Firebase (push)** | Create the project, then set `FCM_*` on the server and the `FIREBASE_*` build values for the apps (see `apps/customer-mobile/README.md`). |

After changing `.env` on the server, restart:

```bash
cd /opt/petapp && export IMAGE_TAG=$(cat .deployed-tag) DEPLOY_ENV=production REGISTRY=ghcr.io/<name>/petapp
docker compose -f compose.yml up -d api worker admin web
```

## 12. Backups and the mobile apps

**Nightly backup**, encrypted, to the backups bucket. On the server, run `crontab -e` as `deploy` and add this one line (20:00 UTC is 01:30 India time):

```bash
0 20 * * * cd /opt/petapp && IMAGE_TAG=$(cat .deployed-tag) DEPLOY_ENV=production REGISTRY=ghcr.io/<name>/petapp docker compose -f compose.yml --profile jobs run --rm backup node scripts/ops/backup.mjs >> /opt/petapp/backup.log 2>&1
```

DigitalOcean also keeps its own daily backups of the managed database, with point-in-time recovery. Once a quarter, practise a restore (see "Restore drill" in `docs/DEPLOYMENT.md`).

**Store builds:** go to **Actions → mobile release → Run workflow**, and pick the app and the platform. The builds point at `API_BASE_URL`. The signing keys and store accounts the workflow needs are listed in `docs/STORE-RELEASE.md`. To try the live API on your own Android phone first:

```powershell
cd apps\customer-mobile
flutter run --dart-define=API_BASE_URL=https://api.yourdomain.in
```

## 13. Everyday work

| You want to… | Do this |
|---|---|
| Release a change | `git add . ; git commit -m "…" ; git push`. CI runs, the build and deploy follow, then approve production. |
| Roll back | Actions → deploy → Run workflow, and put the older commit in **Commit to deploy**. (By hand on the server: `docker login ghcr.io` with a GitHub token that can read packages, then `REGISTRY=ghcr.io/<name>/petapp bash /opt/petapp/deploy.sh <old-tag> production`; the tags are the 12-character commit ids.) |
| Read the logs | On the server: `cd /opt/petapp && export IMAGE_TAG=$(cat .deployed-tag) DEPLOY_ENV=production REGISTRY=ghcr.io/<name>/petapp && docker compose -f compose.yml logs -f --tail 100 api worker` |
| Check health | Dashboard → **System health**, or `curl.exe https://api.yourdomain.in/ready` |

## 14. If something goes wrong

| Symptom | Cause and fix |
|---|---|
| API log says `self-signed certificate in certificate chain` | `DATABASE_CA_CERT` (or `REDIS_CA_CERT` for Redis) is missing or wrong. Paste the provider's CA as base64. |
| The `migrate` step fails on the certificate | Add `&sslaccept=accept_invalid_certs` to `DATABASE_URL`. The API and backups still verify against `DATABASE_CA_CERT`. |
| `Invalid environment` / "…is not allowed in staging/production" | A test provider or a missing key in `.env`; the message names it. Fix `.env`, then deploy again or restart. |
| `extension "postgis" is not available` / permission denied | Step 4 wasn't done as `doadmin`. |
| Deploy fails at `deploy.sh: Permission denied` or `docker: permission denied` | The `deploy` user isn't in the `docker` group (`usermod -aG docker deploy`, then log in again). |
| The site shows 502 | A container is down. Read the logs (step 13); `deploy.sh` rolls back on its own when a deploy is unhealthy. |
| Photos work but videos don't play | `MEDIA_PUBLIC_BASE_URL` is wrong, or the `media/*` public-read policy is missing (step 3.4). |
| App sign-in SMS never arrives | Check the DLT template match and the SMSLocal balance. The API log shows the provider's answer. |
| `https://…` certificate errors right after setup | DNS hasn't spread yet. Wait, then `systemctl reload caddy`. |

Before announcing the launch, work through `docs/LAUNCH-CHECKLIST.md`.
