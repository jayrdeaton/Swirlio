# App Store

Everything the iOS listing needs. The text lives in `store.config.json` (repo root), which `eas metadata:push` sends to App Store Connect. The rest is set by hand in App Store Connect once and carries over to later versions. Google Play's checklist is `store/google-play.md`; when the description below changes, change Play's the same way.

## Pushed by EAS Metadata (`store.config.json`)

Title, subtitle, promotional text, description, keywords, marketing/support/privacy URLs, copyright, categories (Entertainment, with Graphics & Design second: there's nothing to win, so not Games) and What's New. Not the age rating: see Age rating under Set by hand.

```bash
eas metadata:lint
```

```bash
eas metadata:push
```

`push` needs the app record to exist in App Store Connect and edits its editable version, numbered from `store.config.json`'s `apple.version`: keep that equal to `app.json`'s `expo.version` and bump both every release. Without it the push fails with "missing versionString" and skips the copyright, promotional text, description, keywords and support/marketing URLs. The first `eas submit` creates the record (named by `eas.json`'s `submit.production.ios.appName`) when you sign in with your Apple ID. Apple's API can't create apps, so with an API key create it first: My Apps > + > New App, bundle ID `com.infinitetoken.Swirlio`, name `Swirlio`, primary language English (U.S.).

Limits: title 30, subtitle 30, promotional text 170 (editable any time without review), description 4000, keywords 100 in total with the commas. Keywords don't repeat words already in the title or subtitle ("swirlio", "kaleidoscope", "fidget" and "toy" are indexed from those). Swirlio isn't a Tastic game, so the name has no "Tastic".

The three URLs are this app's own web deployment (see "Web" in `.claude/CLAUDE.md`): `public/privacy.html` and `public/support.html` are served at `/privacy` and `/support`. They must be live before review, since the reviewer opens them.

`releaseNotes` (What's New, 4000 at most) is in `info.en-US` from 1.1.0 on: rewrite it for every version from the commits since the previous version's tag (1.1.0's from `git log v1.0.2..v1.1.0`), with only what an iPhone or iPad player will notice, nothing that only changes fresh installs' defaults, and no claim nobody has checked on a device (1.1.0's leaves out Split View and Stage Manager for that reason).

## Screenshots (uploaded by hand)

`store/screenshots/iphone-medium/` (1206x2622, for the required "6.1" or 6.3" displays" slot), `store/screenshots/iphone/` (1320x2868, for the optional 6.9" slot) and `store/screenshots/ipad/` (13", 2064x2752). Apple scales these to every smaller device. The iPad set is required because `ios.supportsTablet` is on. The order in the folder is the upload order; the first three are what search results show.

The PNGs are build output and are gitignored, along with the raw captures they were made from (`store/screenshots/raw/`). The captions are in `store/screenshots.json`.

How they were made (2026-10-19, version 1.0.1): a Release build on the `AppStore iPhone 6.9` (iPhone 17 Pro Max) and `AppStore iPad 13` (iPad Pro 13" M5) simulators, status bar pinned to 9:41 with full battery, dark appearance. The saved settings were written before each launch by `store/seed/reseed.sh` from the looks in `store/seed/looks.json` (sound off, the photosensitivity warning and the guide marked seen, then a look's settings over the defaults), so every frame is the app drawing a real look. Each look was captured a few times while its colors cycled, and the best moment kept. A compositor puts each capture under its caption in SF Pro Bold (the app's own system font), on a gradient from each look's background colors. The tools (simulator setup, the slim build, the compositor) are in Jay's `app-store-prep` skill.

To redo them:

1. Build and install a Release copy on both simulators (the skill's `sim-build.sh` and `sim-setup.sh --app`), and grant it the microphone and motion: `xcrun simctl privacy <udid> grant microphone com.infinitetoken.Swirlio` (and `motion`), so no permission prompt covers a shot
2. `store/seed/reseed.sh <udid> <look> [extra settings json]` on each, then capture into `store/screenshots/raw/<device>/<name>.png` with `xcrun simctl io <udid> screenshot`:
   - **01-kaleidoscope:** look `flower`, controls hidden; a frame with two contrasting colors and the flower's center in view
   - **02-mirror:** look `star` (dashes, 4 mirror lines, a mirror gap)
   - **03-beads:** look `beads` (150 beads around the gravity well, which shows); on iPad add `'{"particleSize":18}'` so the beads read at that size. Capture within a few seconds of launch, before gravity packs them tighter
   - **04-targets:** look `spiral` (its `controlsAutoHideSpeed` 0 keeps the controls up), tap the big bottom-center button to fan out the five gesture targets
   - **05-colors:** look `spiral`, tap the palette button (fourth on the right)
   - **06-audio:** look `flower` with `'{"showLabels":true,"controlsAutoHideSpeed":0}'`, tap the gear, then drag Auto-Hide Delay back until it reads 5.0s (the default) and capture at once, before the controls fade
3. The skill's `compose.mjs store/screenshots.json`

## Header and search results art (optional, iOS 27+)

`store/screenshots/header.png` (3840 x 1646, the product page header) and `store/screenshots/search.png` (3840 x 2560, the search results card), shown on iOS 27 and iPadOS 27 and later. Both are optional. Gitignored like the screenshots; remake them with:

```bash
node store/creative/build.mjs
```

How they were made (2026-10-19): `store/creative/build.mjs` bundles the canvas's own pure math from `src/constants` with esbuild (`flowerMath`, `kaleidoscope`, `rippleMath`, `strokeFit`, `strokeDash`, `colorBlend` and the default settings) and walks it the way `Spiral.tsx` and `KaleidoscopeCopy.tsx` do: the ripple pool at `rippleProgress`, stroked at `fitStrokeToSpacing`, one copy per wedge (`wedgeClipPath`, `wedgeContentTransform`), stroke and fill swapped on every other wedge for alternating colors. The result is a static SVG at the exact pixel size, so nothing is an upscaled capture. The looks come from `store/seed/looks.json`, the same ones the screenshots used. Jay's `app-store-prep` skill's `creative.mjs` renders each page in headless Chrome, strips the alpha channel, checks the size and writes two previews: `-safe.png` (half size, Apple's safe area outlined) and `-384.png` (about the size of a search card).

- **Header:** the `flower` look (6 petals, 6 mirror lines, alternating colors) centered in the safe area, magenta against the look's indigo, running out to every edge. No words, since the app's name sits right under it.
- **Search results:** the first screenshot's caption, "A Kaleidoscope You Can Touch", on the left, and that capture (`raw/iphone/01-kaleidoscope.png`) in a phone on the right. Behind both, the same flower look drawn in its own two background colors, so the words stay readable. English only, so it goes on the en-US localization alone.

To upload: the version's Product Page Information > Header and Search Results, pick Header or Search Results, drop the file in, then use **Preview** to check iPhone and iPad in both orientations. EAS Metadata can't push them. They're reviewed with the version, or on their own through Asset Library.

## Set by hand in App Store Connect

**App Privacy:** "Yes, we collect data from this app", two types, matching Google Play's Data safety form (`store/google-play.md`) and following Expo's store privacy guide (https://docs.expo.dev/eas-update/store-privacy-declarations/), as CardTastic, DuelTastic and PuckTastic do (Jay's call for those, 2026-11-11; Swirlio was Data Not Collected through 1.0.2, and the answer changes in App Store Connect by hand). The only thing that leaves the device is Expo's update check at launch: it carries the app version, the platform, a random installation ID the app makes on its first launch (`EAS-Client-ID`, not the advertising identifier or anything tied to the person) and, only after an update failed to start, that update's ID and the first 1,024 characters of its error. Expo keeps the ID to count installs per update and roll updates out, which is longer than serving the request needs, so Apple counts it as collected. In App Store Connect, App Privacy:
  - **Identifiers > Device ID:** App Functionality and Analytics (Expo counts installs per update); not linked to the user; not used for tracking.
  - **Diagnostics > Crash Data:** App Functionality; not linked to the user; not used for tracking.
  - Nothing else. Audio Reactive reads the microphone, and tilt and shake read the motion sensors, but both are processed in memory on the device and never stored or sent, which Apple doesn't count as collection. Settings and look history stay in on-device storage. No tracking, so no App Tracking Transparency prompt. The label then reads "Data Not Linked to You: Identifiers, Diagnostics".

  The privacy policy's App Updates section (https://swirlio.infinitetoken.com/privacy, `public/privacy.html`) describes the same check, including the failed-update report (added 2026-11-11; it reaches the site with the next web deploy). Revisit both forms if analytics, crash reporting, ads or accounts are ever added.

**Age rating** (App Information, Age Rating; by hand until eas-cli can send it): Apple has required an answer to its Social Media question since September 2026, and eas-cli 27.7.2's metadata schema has no `socialMedia` field, so a push with `advisory` updates everything else and then fails ("You must provide a value for the attribute 'socialMedia'", seen on 1.1.0's push, 2026-11-11). It's out of `store.config.json`, as in the other apps. Every content question None: no violence of any kind, horror or fear, mature or suggestive themes, profanity or crude humor, alcohol, tobacco or drugs, sexual content or nudity, medical or treatment information, guns or other weapons, simulated gambling or contests. No for Gambling, Loot Boxes, Advertising, Messaging and Chat, User-Generated Content, Social Media, Unrestricted Web Access, Parental Controls, Age Assurance and Health or Wellness Topics. Not made for kids (no Kids category). The result is 4+, as 1.0.x had. Google Play's IARC answers (`store/google-play.md`) match these. Put `advisory` back once eas-cli's schema has `socialMedia`.

**App Review Information:** sign-in not required. Contact: name, email and phone (the phone stays out of `store.config.json`, which is public). Notes:

> No account or sign-in is needed, and there are no in-app purchases or ads.
>
> Swirlio is a kaleidoscope toy with no goal. Drag, pinch, twist and tap the screen to play with the pattern. The on-screen controls fade out after a few seconds; tap the bottom edge or the top right corner to bring them back.
>
> The microphone is only requested when Audio Reactive is turned on in Settings. The app measures the sound level in memory to move the pattern and never records or sends audio. The motion sensors drive Tilt and Shake to Randomize.
>
> On first launch a photosensitivity warning appears (tap I Understand), followed by a five-card How to Play guide (tap Skip to go straight to the app).

**Content Rights:** no third-party artwork. The icon font is MaterialCommunityIcons through `@expo/vector-icons` (Apache 2.0). The three interface sounds in `assets/sounds/` (typewriter, shutter, relay) come from Jay's `Sounds` folder; confirm they're original recordings, or note their source here, before answering "no third-party content".

**Pricing and Availability:** Free (0.00 USD base price), every country or region except China mainland (every app there needs an ICP filing number) and Vietnam (its license rule is for games, which Swirlio isn't, so it could be added later; left out to match the fleet). Apple Silicon Mac and Apple Vision Pro availability unticked: the app has never been run on either, and a Mac has no motion sensor for tilt and shake.

**Export compliance:** already answered by `ITSAppUsesNonExemptEncryption: false` in `app.json`, so App Store Connect doesn't ask.

**Accessibility (optional):** leave blank until each feature has been checked on a device. Apple asks per feature (VoiceOver, Larger Text, Dark Interface, Reduced Motion and so on), and a claim that doesn't hold up is worse than none.

**Version release:** automatic after approval, or manual (you press Release). Manual is the safer choice for the first version.

## Shipping a version

1. `npm run verify`
2. `jrd ship build production`
3. `eas submit -p ios --profile production` (uploads the build to TestFlight)
4. `eas metadata:push`
5. Upload the screenshots, and the header and search art, if they changed
6. In App Store Connect: pick the build, fill in anything new above, and Add for Review
