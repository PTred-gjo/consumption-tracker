# Publishing FuelPilot

Everything needed to get a release onto Google Play or onto the web. Follow it
top to bottom the first time; after that only the "Cutting a release" section
matters.

---

## 1. One-time setup

### 1.1 Create the upload keystore

Google Play signs the app it delivers to users, but you sign what you upload.
That upload key must never change or be lost — losing it means you cannot ship
another update under the same listing.

```bash
keytool -genkey -v \
  -keystore upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias fuelpilot
```

Store `upload.jks` and both passwords in a password manager. Back them up
somewhere that is not this repository — `.gitignore` deliberately blocks
`*.jks`, `*.keystore` and `android/keystore.properties` from ever being
committed.

### 1.2 Point local builds at the key

Create `android/keystore.properties` (already gitignored):

```properties
storeFile=/absolute/path/to/upload.jks
storePassword=…
keyAlias=fuelpilot
keyPassword=…
```

Builds also read `FUELPILOT_KEYSTORE_FILE`, `FUELPILOT_KEYSTORE_PASSWORD`,
`FUELPILOT_KEY_ALIAS` and `FUELPILOT_KEY_PASSWORD` from the environment, which
is how CI supplies them. With neither configured the release build still runs
and simply produces an unsigned bundle.

### 1.3 Add the CI secrets

In **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_ALIAS` | `fuelpilot` |
| `ANDROID_KEY_PASSWORD` | the key password |

### 1.4 Host the privacy policy

Play requires a publicly reachable privacy policy URL for every app.
[`PRIVACY.md`](../PRIVACY.md) is written to serve as one. Publish it somewhere
stable — GitHub Pages off this repository is enough — and paste that URL into
the Play Console listing.

---

## 2. Cutting a release

```bash
# 1. Bump the version. Everything else reads it from here:
#    the in-app version, the Android versionName, and the tag check in CI.
npm version 1.0.1 --no-git-tag-version

# 2. Verify locally.
npm run check          # lint + tests + web build

# 3. Commit, tag and push.
git commit -am "release: v1.0.1"
git tag v1.0.1
git push origin main --tags
```

Pushing the tag runs `.github/workflows/release.yml`, which lints, tests,
verifies the tag matches `package.json`, builds a signed `.aab` and `.apk`, and
attaches both to a GitHub release.

`versionCode` comes from the workflow run number, so it always increases —
which is Play's only hard requirement for it.

### Building a release locally instead

```bash
npm run android:bundle   # android/app/build/outputs/bundle/release/app-release.aab
npm run android:apk      # android/app/build/outputs/apk/release/app-release.apk
```

Upload the **`.aab`** to Play; the `.apk` is for sideloading and testing.

---

## 3. Play Console checklist

The technical requirements the code already satisfies:

- [x] Targets API 35 (required for new apps and updates)
- [x] Signed with an upload key
- [x] Android App Bundle format
- [x] `versionCode` increases on every upload
- [x] Backup and data-extraction rules declared
- [x] Only permissions the app actually uses, each justified in `PRIVACY.md`

What you still have to supply in the console:

- [ ] **Privacy policy URL** — see 1.4
- [ ] **Data safety form** — declare *no data collected* and *no data shared*.
      This is accurate: nothing leaves the device.
- [ ] **Store listing** — title, short and full description, feature graphic
      (1024×500), and at least two phone screenshots
- [ ] **App icon** — 512×512 PNG. Use `public/icon-512.png`, or regenerate the
      set with `npm run icons`
- [ ] **Content rating questionnaire** — a utility with no user-generated
      content or ads rates as *Everyone*
- [ ] **Target audience** — not directed at children
- [ ] **Ads declaration** — the app contains none

### Suggested listing copy

**Short description (max 80 characters)**

> Track fuel costs, real consumption and car maintenance. Offline, no account.

**Full description**

> FuelPilot turns your fill-ups into numbers you can act on: true litres per
> 100 km, real cost per kilometre, and where your fuel money actually goes.
>
> • Log fill-ups in seconds — date, odometer, litres, price, station
> • Accurate consumption from full-tank measurements, with a fallback for
>   partial fills
> • Cost per kilometre, monthly spend, price history and yearly comparisons
> • Maintenance reminders by date or distance, with service history
> • Multiple vehicles, multiple fuel types, your choice of currency
> • Monthly budget, low-range warnings and refuel reminders
> • Import from Fuelio CSV, export to JSON or CSV whenever you like
>
> Everything stays on your phone. No account, no sign-up, no tracking, and it
> works with no connection at all.

---

## 4. Publishing as a PWA

The web build in `dist/` is a static site and can go on any static host.

```bash
npm run build
```

Two requirements for installability:

- **Serve over HTTPS.** Service workers and the install prompt are unavailable
  otherwise (`localhost` is exempt for development).
- **Serve `sw.js` from the site root** with `Cache-Control: no-cache`, so an
  updated worker is actually picked up.

CI checks that the manifest, service worker and icons are present in `dist`
before the build is accepted, since a missing icon silently makes the app
non-installable.

---

## 5. Verifying a build before you ship it

```bash
npm run check
```

Then, on the release APK:

- Install it on a device running Android 15 and confirm the layout clears the
  status bar and gesture area — API 35 forces edge-to-edge.
- Add a vehicle, log two full-tank fills and confirm the consumption figure.
- Attach a receipt photo and check Settings → Device storage moves.
- Schedule a maintenance notification and confirm the permission prompt appears.
- Export a backup, clear all data, and import it back.

The R8-shrunk release build exercises different code paths from a debug build,
so test the release artifact, not the debug one.
