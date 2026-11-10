# Hosting PetApp free on Render

This guide puts the whole of PetApp online for free on [Render](https://render.com): the API with its background worker, the admin dashboard, the public website, a PostgreSQL database and Redis. The phone apps are built on your PC and pointed at it.

The free setup is a **demo**:
- Sign-in codes appear in Render's logs instead of being sent by SMS.
- Payments are simulated.
- Emails are written to the logs.

That is enough to try every feature. To run it for real users, with real SMS, payments and backups, follow `GO-LIVE.md`.

Commands are for Windows PowerShell.

## What the free plan gives you, and its limits

| Part | On Render's free plan | What it means for PetApp |
|---|---|---|
| API, admin dashboard, website | 3 free web services: 512 MB, 0.1 CPU each | They sleep after 15 minutes without visits; the first visit then takes about a minute. |
| Free hours | 750 a month, **shared** by the 3 services | Fine for a demo that sleeps most of the day. If they run out, the services stop until the 1st of the month. |
| Database | PostgreSQL, 1 GB | **Expires 30 days after you create it**, with 14 more days to upgrade before it's deleted. No backups. |
| Redis (Key Value) | 25 MB, in memory only | A restart loses queued jobs (for example, a reminder that hadn't been sent). |
| Background worker | Paid only on Render | PetApp runs the worker inside the API service, so it also sleeps when the API sleeps. Scheduled jobs (reminders, clean-ups) run when the service is awake. |
| Email | Ports 25, 465 and 587 are blocked | Emails are printed in the API's logs. |
| Video | 0.1 CPU | Videos are processed, but slowly: a 30-second reel can take several minutes. |

Render's own pages: [free plan](https://render.com/docs/free), [instance sizes](https://render.com/docs/compute-plans). These numbers can change.

## 1. Download and unzip

Download `petapp-final.zip`, then:

```powershell
cd $HOME\Downloads
Expand-Archive petapp-final.zip -DestinationPath D:\PetApp -Force
cd D:\PetApp\petapp
```

The folder includes `render.yaml`, which describes the five pieces to Render. The pieces Render uses are:
- `infrastructure\render\Dockerfile.api`
- `infrastructure\Dockerfile.admin`
- `infrastructure\Dockerfile.web`
- the start script, `scripts\render\start-api.mjs`

## 2. Put the code on GitHub

Render deploys from a Git repository.

```powershell
winget install Git.Git GitHub.cli      # once; then close and reopen PowerShell
cd D:\PetApp\petapp
git init -b main
git add .
git status                             # .env must NOT be listed
git commit -m "PetApp"
gh auth login                          # GitHub.com, HTTPS, sign in with the browser
gh repo create petapp --private --source . --push
```

## 3. Photo and video storage (optional, but needed for uploads)

Without storage everything works except uploading photos, videos and documents. Storage must be S3-compatible. Two have a free 10 GB tier:

| | **Backblaze B2** | **Cloudflare R2** |
|---|---|---|
| Card needed | No, for a private bucket. A small card payment is needed for a public bucket. | Yes, to activate R2, even if you stay free |
| Free | 10 GB stored; downloads free up to 3× what's stored | 10 GB stored; downloads free |
| Videos play | Only with a public bucket | Yes, with the r2.dev public address |
| `S3_ENDPOINT` | `https://s3.<region>.backblazeb2.com` (shown on the bucket page, for example `us-west-004`) | `https://<account id>.r2.cloudflarestorage.com` |
| `S3_REGION` | the region part, for example `us-west-004` | `auto` |
| `MEDIA_PUBLIC_BASE_URL` | the bucket's public address, ending in `/file/<bucket name>` | the bucket's `https://pub-….r2.dev` address |

Without a public address, leave `MEDIA_PUBLIC_BASE_URL` empty: photos still show (through short-lived signed links), but videos won't play.

Create a bucket, then an access key limited to that bucket. Keep the key ID and secret for step 4.

In a public bucket, anyone who knows a file's address can open it. The addresses are long random names, and that includes people's data exports. That is acceptable for a demo; for real users, `GO-LIVE.md` makes only the `media/` folder public.

## 4. Create everything on Render

1. Sign up at [render.com](https://render.com) with your GitHub account. No card is needed.
2. Go to **New → Blueprint**, pick your `petapp` repository, and give the Blueprint a name.
3. Render reads `render.yaml` and asks for the values below. The addresses are guesses at this point: Render names each service `https://<service name>.onrender.com` unless that name is taken (step 6 checks).

   | Service | Setting | Value |
   |---|---|---|
   | petapp-api | `SEED_ADMIN_EMAIL` | your email, for the dashboard |
   | petapp-api | `SEED_ADMIN_PASSWORD` | 12+ characters, not a common password |
   | petapp-api | `DASHBOARD_URL` | `https://petapp-admin.onrender.com` |
   | petapp-api | `CORS_ORIGINS` | `https://petapp-admin.onrender.com,https://petapp-web.onrender.com` |
   | petapp-api | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_BASE_URL` | from step 3, or leave empty |
   | petapp-admin | `BACKEND_URL` | `https://petapp-api.onrender.com` |
   | petapp-web | `API_URL` | `https://petapp-api.onrender.com` |
   | petapp-web | `SITE_URL` | `https://petapp-web.onrender.com` |
   | petapp-web | `SUPPORT_EMAIL` | an address people can write to |

4. Click **Apply** (or **Deploy Blueprint**).

What happens next:
- **The builds:** Render creates the database and Redis, then builds three Docker images. The first builds take about 10–20 minutes. Each service's **Events** and **Logs** tabs show progress.
- **The API's first start:**
  - creates every table
  - fills in roles, settings, India's cities, your admin account and demo users
  - switches all features on except paid voting

  On the free CPU this takes a few minutes. Later starts skip it.

The API's log shows:
```
[render-start] seeding the database
• Created SUPER_ADMIN you@example.com
[render-start] switched on: ENABLE_CONTESTS, …
PetApp API listening on :10000
PetApp worker running
```

## 5. Check it works

```powershell
curl.exe https://petapp-api.onrender.com/ready     # database and redis should be "ok"
start https://petapp-api.onrender.com/api/docs     # the API reference
start https://petapp-admin.onrender.com            # sign in with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
start https://petapp-web.onrender.com
```

If a service is asleep, the first request takes about a minute.

## 6. If Render gave a service a different address

Open each service in the Render dashboard and compare its address at the top with what you typed in step 4. If one differs, for example `petapp-api-x7k2.onrender.com`:
1. Go to **Environment** and fix the values that point at it (`BACKEND_URL`, `API_URL`, `DASHBOARD_URL`, `CORS_ORIGINS`, `SITE_URL`).
2. Click **Save, rebuild and deploy**.

## 7. First things in the dashboard

1. **Your account:** turn on two-factor sign-in.
2. **Legal:**
   - Fill in your company details in each draft (terms, privacy, contest rules) and publish them.
   - People are asked to accept them before contests and the shop.
3. **Help:** publish the FAQs you want.
4. **Locations:** add areas and PIN codes for your cities, and switch on services in a city.
5. **Contests, Challenges, Shop:** create your first contest, challenge and product categories.
6. **Settings:** check the fees, tax rates and limits.

## 8. Sign in on the apps and the demo accounts

| Who | Phone number |
|---|---|
| Pet owners | 9000000001, 9000000002, 9000000003 |
| A judge | 9000000004 |
| A grooming partner (Pawfect Grooming Spa) | 9000000005 |
| A seller (no shop yet) | 9000000006 |

Any other phone number creates a new account. The sign-in code isn't texted; find it in **petapp-api → Logs** (search for `DEV SMS`):

```
DEV SMS → +91******0001] 482913 is your PetApp verification code…
```

Payments open a simulated checkout that succeeds at once. Refunds and partner payouts are simulated too.

## 9. Build the phone apps for this server

On your PC (once): install Flutter 3.27.4 and Android Studio.

```powershell
winget install Google.AndroidStudio
# Flutter: download 3.27.4 from https://docs.flutter.dev/release/archive, unzip to C:\flutter, then:
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\flutter\bin", "User")
# reopen PowerShell
flutter doctor --android-licenses
flutter doctor
```

Build each app against your Render API. The first command creates the Android project files; run it once per app.

```powershell
$API = "https://petapp-api.onrender.com"
$SITE = "https://petapp-web.onrender.com"

cd D:\PetApp\petapp\apps\customer-mobile
flutter create . --org com.petapp --project-name petapp --platforms android
flutter pub get
flutter build apk --release --dart-define=API_BASE_URL=$API --dart-define=SHARE_BASE_URL=$SITE

cd ..\service-partner-mobile
flutter create . --org com.petapp --project-name petapp_partner --platforms android
flutter pub get
flutter build apk --release --dart-define=API_BASE_URL=$API

cd ..\product-partner-mobile
flutter create . --org com.petapp --project-name petapp_seller --platforms android
flutter pub get
flutter build apk --release --dart-define=API_BASE_URL=$API
```

Each APK is in that app's `build\app\outputs\flutter-apk\app-release.apk`. Copy it to an Android phone and open it, allowing installs from that source. These APKs are signed with Flutter's test key, which is fine for trying them; Play Store builds are covered in `STORE-RELEASE.md`.

To try an app in Chrome instead:

```powershell
flutter run -d chrome --dart-define=API_BASE_URL=https://petapp-api.onrender.com
```

## 10. Updating

Push to GitHub, and Render rebuilds and redeploys each service:

```powershell
git add . ; git commit -m "Describe the change" ; git push
```

New database migrations are applied automatically when the API starts.

| To… | Do this |
|---|---|
| Run the seed again (it's safe to repeat) | Set `RESEED=true` on petapp-api, deploy, then remove it |
| Turn background jobs off (if the API runs out of memory) | Set `RUN_WORKER=false` |
| Use Razorpay's free test mode (real checkout screen, test cards) | Set `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, using your `rzp_test_…` keys |
| Keep the database after 30 days | In Render, upgrade petapp-db to a paid plan before it expires (the data is kept) |

## 11. If something goes wrong

| What you see | Cause and fix |
|---|---|
| petapp-api's log: `Invalid environment configuration` | A setting is wrong; the line names it. Fix it under **Environment**. |
| `SEEDING FAILED` in the log | Usually a weak `SEED_ADMIN_PASSWORD`. Change it, set `RESEED=true` and deploy again. |
| The dashboard says it can't reach the server | `BACKEND_URL` is wrong (step 6), or the API is waking up: wait a minute and reload. |
| Sign-in on the dashboard loops back to the login page | Use the `https://` address. `COOKIE_SECURE=true` needs HTTPS. |
| "Media storage is not configured." when uploading | Storage isn't set up (step 3). |
| Photos load but videos don't play | `MEDIA_PUBLIC_BASE_URL` is empty or not public (step 3). |
| Out of memory, or the API restarts | Free instances have 512 MB. Set `RUN_WORKER=false`, or move petapp-api to the Starter plan. |
| Everything stopped near the end of the month | The 750 free hours ran out. They reset on the 1st, or you can upgrade one service. |
| Database gone after about 6 weeks | Free databases are deleted 44 days after creation unless upgraded. Deploy again with `RESEED=true` to start fresh. |
