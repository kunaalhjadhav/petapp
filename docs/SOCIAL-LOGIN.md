# Sign in with Google (Android) and Apple (iPhone)

All three apps (the customer app, the partner app and the seller app) offer, under the mobile-number sign-in:
- **Android:** a **Continue with Google** button
- **iPhone:** a **Sign in with Apple** button

The phone gets a signed token from Google or Apple. The API checks it against their public keys:
- Google: its audience must be your Web client ID.
- Apple: its audience must be one of your bundle IDs, and its nonce must match the one-time value the app made.

Then the API signs in:
- the account already linked to that Google or Apple ID,
- or else the account with the same email address (Google and Apple have verified it),
- or else a new account.

The admin dashboard keeps email + password + two-factor sign-in.

Nothing here costs money for Google. Apple needs the paid Apple Developer Program (99 USD a year), and iPhone builds need a Mac or the **mobile release** GitHub workflow.

Commands are for Windows PowerShell.

## The app IDs

Google and Apple tie sign-in to these IDs. They come from `flutter create --org …` and can't change after the first store upload.

| App | Folder | Android package | iOS bundle ID |
|---|---|---|---|
| Customer | `apps\customer-mobile` | `com.petapp.petapp` | `com.petapp.petapp` |
| Partner | `apps\service-partner-mobile` | `com.petapp.partner.petapp_partner` | `com.petapp.partner.petappPartner` |
| Seller | `apps\product-partner-mobile` | `com.petapp.seller.petapp_seller` | `com.petapp.seller.petappSeller` |

Generate the folders with exactly these `--org` values (as `docs/RENDER.md` step 9 and the release workflow do):

```powershell
cd D:\PetApp\petapp\apps\customer-mobile;        flutter create . --org com.petapp         --project-name petapp         --platforms android,ios
cd D:\PetApp\petapp\apps\service-partner-mobile; flutter create . --org com.petapp.partner --project-name petapp_partner --platforms android,ios
cd D:\PetApp\petapp\apps\product-partner-mobile; flutter create . --org com.petapp.seller  --project-name petapp_seller  --platforms android,ios
```

To check one: the Android package is `applicationId` in `android\app\build.gradle.kts`, and the iOS bundle ID is `PRODUCT_BUNDLE_IDENTIFIER` in `ios\Runner.xcodeproj\project.pbxproj`.

## Google (Android)

### 1. Create the Google Cloud project and consent screen
1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a project, for example `PetApp`.
2. Go to **APIs & Services → OAuth consent screen** (in newer consoles: **Google Auth Platform → Branding**). Then:
   - Choose **External**.
   - Fill in the app name (PetApp), the support email, and the links to your privacy policy and terms (`https://<your website>/legal/privacy-policy`).
   - Add only the scopes `openid`, `email` and `profile`.
3. Under **Audience**, either:
   - add the Google accounts that may test while it's in **Testing**, or
   - click **Publish app**. With only these basic scopes, Google doesn't need to review it.

### 2. Create the Web client (the API checks tokens against it)
1. Go to **Credentials → Create credentials → OAuth client ID → Web application**.
2. Name it `PetApp server`. It needs no redirect URIs.
3. Copy its **Client ID**, for example `1234567890-abc123.apps.googleusercontent.com`. It is used in two places:
   - **The API:** `GOOGLE_CLIENT_IDS`
   - **The app builds:** `--dart-define=GOOGLE_SERVER_CLIENT_ID=…`

The client secret is not needed.

### 3. Create one Android client per app and signing key
Google only lets an app use sign-in when its package name and signing-key fingerprint (SHA-1) are registered.

Get the SHA-1 of the key that signs your builds.

**The builds from `docs/RENDER.md` step 9 and `flutter run`** use the debug key on your PC:

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -list -v -alias androiddebugkey -storepass android -keypass android -keystore "$env:USERPROFILE\.android\debug.keystore" | Select-String SHA1
```

**Release builds signed with your upload key:**

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -list -v -alias upload -keystore D:\keys\upload.jks | Select-String SHA1
```

**Installs from Google Play** are signed by Google. Copy the SHA-1 from **Play Console → your app → Test and release → App integrity → App signing key certificate**.

Then, for each app and each SHA-1:
1. Go to **Credentials → Create credentials → OAuth client ID → Android**.
2. Enter the package name from the table above and paste the SHA-1.

For the free demo, you need three Android clients (one per app) with your debug SHA-1. Add the upload key and Play signing key SHA-1s when you publish to Play.

### 4. Tell the API
- **On Render:** go to **petapp-api → Environment** and set `GOOGLE_CLIENT_IDS` to the Web client ID, then click **Save, rebuild and deploy**.
- **On your own server:** set it in `prod.env` (`docs/GO-LIVE.md`).

### 5. Build the Android apps with it

```powershell
$API = "https://petapp-api.onrender.com"
$GOOGLE = "1234567890-abc123.apps.googleusercontent.com"   # the Web client ID

cd D:\PetApp\petapp\apps\customer-mobile
flutter build apk --release --dart-define=API_BASE_URL=$API --dart-define=SHARE_BASE_URL=https://petapp-web.onrender.com --dart-define=GOOGLE_SERVER_CLIENT_ID=$GOOGLE
cd ..\service-partner-mobile
flutter build apk --release --dart-define=API_BASE_URL=$API --dart-define=GOOGLE_SERVER_CLIENT_ID=$GOOGLE
cd ..\product-partner-mobile
flutter build apk --release --dart-define=API_BASE_URL=$API --dart-define=GOOGLE_SERVER_CLIENT_ID=$GOOGLE
```

Without `GOOGLE_SERVER_CLIENT_ID` the Google button is hidden and mobile-number sign-in works as before.

For store builds, set the repository variable `GOOGLE_SERVER_CLIENT_ID` (**GitHub → Settings → Secrets and variables → Actions → Variables**). The **mobile release** workflow passes it on.

## Apple (iPhone)

### 1. Turn on the capability for each app ID
1. Go to [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles → Identifiers**.
2. For each of the three bundle IDs in the table: create it if it's missing, tick **Sign in with Apple** (as a primary App ID), and click **Save**.
3. Regenerate the App Store provisioning profiles afterwards, since they must include the capability. If you use the workflow, update the `IOS_PROVISIONING_PROFILE_BASE64` secret.

No key or service ID is needed: the API only checks the token with Apple's public keys.

### 2. Tell the API
Set `APPLE_CLIENT_IDS` to the bundle IDs, comma-separated:

```
com.petapp.petapp,com.petapp.partner.petappPartner,com.petapp.seller.petappSeller
```

### 3. Build
The app also needs the **Sign in with Apple** entitlement. `scripts\mobile\configure_platforms.py` adds it to `ios\Runner\Runner.entitlements` for all three apps, and the release workflow runs it. On a Mac:

```bash
cd apps/customer-mobile
flutter create . --org com.petapp --project-name petapp --platforms ios
python3 ../../scripts/mobile/configure_platforms.py . --domain petapp.in --release
flutter build ipa --release --dart-define=API_BASE_URL=https://api.petapp.in --dart-define=SHARE_BASE_URL=https://petapp.in
```

Apple gives a name and email only the first time someone signs in to an app. PetApp saves them then. If the person chooses **Hide My Email**, PetApp gets an `@privaterelay.appleid.com` address.

## After signing in
- **New accounts from Google or Apple have no mobile number.** To vote in contests, they add one: **Me → Settings → Mobile number**. Tapping **Vote** without one opens the same screen. A code confirms the number, and they can then also sign in with it.
- **A number that already belongs to another PetApp account can't be added.** The person is told to sign in with that number instead.
- **Every sign-in and number change is in the audit log.**

## If something goes wrong

| What you see | Cause and fix |
|---|---|
| No Google button on Android | The app was built without `--dart-define=GOOGLE_SERVER_CLIENT_ID=…`. |
| "Google sign-in isn't set up for this version of the app yet" | Google's DEVELOPER_ERROR (code 10): no Android client matches this app's package name and the SHA-1 of the key that signed it. Add one (Google step 3). A Play install needs the Play signing key's SHA-1. |
| The Google account picker closes and nothing happens | The account isn't a test user while the consent screen is in **Testing**. Add it, or publish the app. |
| "Google sign-in is not configured." | `GOOGLE_CLIENT_IDS` is empty on the API. |
| "Google sign-in failed. Please try again." | The app was built with a different Web client ID than the one in `GOOGLE_CLIENT_IDS`, or the phone's clock is wrong. |
| "Apple sign-in failed. Please try again." | `APPLE_CLIENT_IDS` doesn't list this app's bundle ID. |
| "Sign in with Apple didn't work" right away on iPhone | The app ID lacks the **Sign in with Apple** capability, or the profile predates it (Apple step 1). |
