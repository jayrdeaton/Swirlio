# Google Play

Swirlio for Android ships through Google Play, from the Infinite Token organization developer account (opened 2026-11-11). The Android app is this repo's Expo app, package `com.infinitetoken.swirlio`, built by EAS as an app bundle (`.aab`); Google signs it for the store with the Play App Signing key, and EAS keeps the upload key. It has never been on Play, so this is a first submission.

Checked 2026-11-11 against Play Console Help and the Developer Program Policies (the app-store-prep skill's Google Play reference).

## What Google asks of Swirlio

- **No closed test:** the 12-tester, 14-day closed test only binds personal accounts made after November 13, 2023, so the organization account publishes to production straight away.
- **Target API level:** new apps must target API 36 (Android 16) since 2026-08-31. Expo SDK 58 targets 36 by default, so nothing is set here.
- **Selling:** nothing is sold anywhere. No in-app purchases, no ads, no prices in the listing.
- **Account deletion:** there are no accounts, so the Data safety form answers no and needs no deletion page.
- **Families policy:** not applicable. The target audience is 13 and over (Jay, 2026-11-11, as for CardTastic, DuelTastic and PuckTastic), so the app is outside it. It would pass today (no ads, no ad SDKs, nothing collected but the update check), but it would bind every later update.
- **Permissions:** `app.json`'s `android.blockedPermissions` takes out what Expo's template and the libraries add and nothing here uses: `ACTIVITY_RECOGNITION` (expo-sensors' pedometer, added 2026-11-11: Swirlio reads only DeviceMotion and the accelerometer, and the permission would read as physical-activity access), `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`. What's left (read from the release APK with `aapt2 dump permissions`, 2026-11-11) is `INTERNET` and `ACCESS_NETWORK_STATE` (the update check), `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` (Audio Reactive), `VIBRATE` (haptics) and `WAKE_LOCK`, which a library adds. `RECORD_AUDIO` is Audio Reactive's, asked for only when it's turned on; the sound is measured in memory and never recorded or sent, so it isn't collected (Data safety, below). No `AD_ID`, so the Advertising ID answer is no. None needs a declaration form.
- **Package name:** Play registers it with the account by itself (Android developer verification). The iOS bundle ID is `com.infinitetoken.Swirlio`; package names are lowercase by convention, and the two don't have to match.
- **ARM only (2026-11-12):** `eas.json`'s production profile builds Android for `armeabi-v7a` and `arm64-v8a` only (`android.env.ORG_GRADLE_PROJECT_reactNativeArchitectures`). With all four architectures, Skia's native libraries ran EAS's free Android machine (4 CPUs, 16 GB) out of memory and Gradle was killed ("Gradle build daemon disappeared unexpectedly"). Every Android phone is ARM, so only x86 emulators and some Intel Chromebooks lose out. CardTastic has no Skia and builds all four. The iOS fingerprint doesn't read `eas.json`, so the iOS builds are unaffected.

## Jay's steps, in order

1. **Create the app** (Play Console, Create app): app name `Swirlio`, default language English (United States), **App** (not Game: there's nothing to win, as on the App Store), **Free** (a free app can't be made paid later), and the declarations (Developer Program Policies, US export laws).
2. **Fill in App content** (the answers below), the **main store listing** (the text and graphics below) and **store settings**.
3. **Build:** `jrd ship build production`, picking All (iOS and Android together: the adaptive icon in `app.json` moves the iOS fingerprint too, so iOS needs its new build anyway). The first Android build asks to make the upload keystore on EAS: yes.
4. **Upload the first bundle by hand** in Play Console (Test and release, Production, Create new release, upload the `.aab`, release notes below): Google's API can't create an app's first release, so `eas submit -p android` only works from the second one on, with a Google Cloud service account key that has Play Console access.
5. **Send for review** (Publishing overview). A new account's first app can take several days. Managed publishing holds an approved release until you press Publish, if Swirlio should go live with the iOS release.
6. **After the first upload:** nothing. Swirlio has no sign-in or App Links, so it needs no `assetlinks.json`.
7. **The website:** deploy it (a `v*` tag, see `.claude/CLAUDE.md`, Web and App Store) so the privacy page's failed-update sentence (added 2026-11-11) is live before review.

Every later version: `jrd ship build production`, `eas submit -p android --profile production` (once `submit.production.android` in `eas.json` has a service account key and a track), the release notes, then send for review.

## Store listing (main store listing)

**App name** (30 at most, 7 used): `Swirlio`

**Short description** (80 at most, 78 used):

> A kaleidoscope fidget toy you can push, pinch, twist, tilt, and shake. No ads.

**Full description** (4000 at most, 1,673 used; the App Store text from `store.config.json` with one Android line: "Light and dark mode, on phones and tablets" for "on iPhone and iPad"):

```
A hands-on kaleidoscope you can push, pinch, twist, tilt, and shake. There's nothing to win: just a moving pattern to play with, with no ads, no accounts, and no tracking.

PLAY WITH IT
• Drag the swirl and it glides to your finger. Throw it and it bounces off the edges
• Drag in circles around it to spin it
• Pinch and twist to reshape it, and tap with two fingers for the next pattern
• Tap to swap the colors
• Shake for a whole new look, or turn on Tilt Control and tilt your device to roll it around

MAKE A KALEIDOSCOPE
• Up to six mirror lines, for twelve copies of the pattern
• Seven patterns: Spiral, Rings, Heart, Burst, Star, Polygon, and Flower
• Six line styles, from solid to dots and dashes
• Colors that blend through a list you pick, forward or in reverse

BEADS AND GRAVITY
• Up to 150 beads that bounce off each other, drawn in every mirror copy
• Swipe through them to scatter them, or hold to gather them under your finger
• A gravity well that pulls the swirl and the beads, or pushes them away

MOVE TO THE MUSIC
• Turn on Audio Reactive and the swirl follows the sound in the room: bass, mids, and treble each drive their own part of it
• The sound is measured on your device and never recorded

RANDOMIZE AND GO BACK
• Randomize any group of controls, or tweak one thing at a time
• Step back through your last 100 looks

• The controls fade away so the whole screen is yours
• Light and dark mode, on phones and tablets
• Plays offline
• A photosensitivity warning on first launch, then a short how-to-play guide you can skip

Also plays in your browser at swirlio.infinitetoken.com

Open source on GitHub: https://github.com/jayrdeaton/Swirlio
```

When the App Store description changes, change this one the same way (that line is the only difference).

**Release notes** for the first release (500 at most, 35 used):

```
Swirlio's first release on Android.
```

**Graphics** (in `store/screenshots/google-play/`, gitignored like the App Store's):

- **App icon:** `icon-512.png`, 512 x 512, 32-bit PNG with alpha (opaque), the iOS icon (`assets/images/dark-icon.png`, the black two-arm spiral on light grey) scaled down: `ffmpeg -i assets/images/dark-icon.png -vf scale=512:512:flags=lanczos -pix_fmt rgba store/screenshots/google-play/icon-512.png`. Google rounds its corners and adds the shadow itself.
- **Feature graphic:** `feature-graphic.png`, 1024 x 500, 24-bit PNG with no alpha: the App Store header art (`store/screenshots/header.png`, drawn by `store/creative/build.mjs` from the canvas's own math: the `flower` look, magenta on indigo, out to every edge) cropped to Play's shape and scaled: `ffmpeg -i store/screenshots/header.png -vf "crop=3371:1646:234:0,scale=1024:500:flags=lanczos" -pix_fmt rgb24 store/screenshots/google-play/feature-graphic.png`. No words, no device frame, the flower's center in the middle.
- **Phone screenshots:** `store/screenshots/android/`, six at 1440 x 2560, no alpha, in upload order, with the alt text in Screenshots below.
- **Tablet screenshots:** none for now (optional).

## Store settings

- **App category:** Entertainment (as on the App Store; Art & Design is the other close one).
- **Tags:** up to five, picked in the console from Play's list. Look for the nearest to Relaxation, Art, Visualizer, Offline and Single player.
- **Contact details:** email jay@infinitetoken.com for now (public; support@infinitetoken.com once it reaches someone, as the other apps), website https://swirlio.infinitetoken.com, no phone.

## App content

- **Privacy policy:** https://swirlio.infinitetoken.com/privacy (`public/privacy.html`; it covers Android, and its App Updates section describes the update check below).
- **App access:** All functionality is available without special access. No account or sign-in exists.
- **Ads:** No, the app doesn't contain ads.
- **Content rating** (IARC questionnaire): email jay@infinitetoken.com; category **All Other App Types** (Swirlio is an app, not a game; pick the nearest if the list's names differ). Violence, fear, sexuality, language, controlled substances and crude humor: none. Gambling: none. Users interact or exchange content: no. Shares the user's location: no. Digital purchases: no. Unrestricted internet access: no. Expected result: Everyone, PEGI 3. Matches the App Store's answers (`store/README.md`, Age rating, all None, so 4+). Swirlio shows a photosensitivity warning on first launch; IARC doesn't ask about flashing images, but if any question touches it, the answer is that the warning is there and the motion can be paused.
- **Target audience and content:** 13-15, 16-17 and 18 and over (Jay, 2026-11-11). Could the store listing unintentionally appeal to children: no (no characters, mascots or child-directed words; a kaleidoscope with a photosensitivity warning). Outside the Families policy. The privacy page's Children section ("made for all ages") is about not collecting data from anyone, and stays.
- **News app:** no. **Government app:** no. **Financial features:** none. **Health:** none.
- **Advertising ID:** the app doesn't use one (no `AD_ID` permission, no ads or analytics SDK).
- **Data safety:** below.

## Data safety

The only thing that leaves the phone is Expo's update check (expo-updates, at launch). It carries a random installation ID the app makes on its first launch (`EAS-Client-ID`, a UUID in the app's own storage: not the Android ID or the advertising ID), the platform and runtime version, and, only after an update failed to start, that update's ID and the first 1,024 characters of its error (`Expo-Fatal-Error`). Expo serves the update as a service provider, so this is collected, not shared. Google's form counts anything sent off the device, and names an app-instance ID like a Firebase installation ID as a Device or other ID, so it's declared, with the purposes from Expo's store privacy guide (https://docs.expo.dev/eas-update/store-privacy-declarations/), the same answers as CardTastic, DuelTastic and PuckTastic (Jay's call for those, 2026-11-11). The privacy policy's App Updates section says the same.

Audio Reactive's microphone and the motion sensors behind Tilt and Shake to Randomize are read and used on the device, in memory, and never sent anywhere, so neither Audio nor anything else is declared for them. Settings and look history stay in the app's own storage.

**Does your app collect or share any of the required user data types?** Yes.
**Is all of the user data collected by your app encrypted in transit?** Yes (HTTPS to u.expo.dev).
**Which account creation methods does your app support?** None (the app has no accounts).

| Data type | Collected / shared | Processed ephemerally | Required or optional | Purposes |
|---|---|---|---|---|
| Device or other IDs | Collected, not shared | No (Expo keeps it to count installs per update and roll updates out) | Required | App functionality, Analytics |
| App info and performance, Crash logs | Collected, not shared | No | Required | Analytics (the error from an update that failed to start, so a broken update can be fixed) |

Not collected: location, personal info, financial info, health and fitness, messages, photos and videos, audio, files and docs, calendar, contacts, app activity, web browsing, other app info and performance.

- **Can users request deletion?** No: the ID isn't linked to anyone, so there is nothing to find and delete by person. Uninstalling the app removes it from the phone.
- **Delete account URL:** none (no accounts).

**The App Store's App Privacy answer matches:** Identifiers > Device ID and Diagnostics > Crash Data, not linked to the user, not tracking (`store/README.md`, App Privacy). It was Data Not Collected through 1.0.2 and was changed in App Store Connect on 2026-11-11, for 1.1.0.

## Screenshots

Six phone shots planned, the same set and captions as the App Store's (`store/screenshots.json`), captioned in Roboto Bold (Android's system font, which the app draws its text in there; the iOS set's SF Pro is licensed for Apple platforms only) above the capture in a Pixel bezel, on each look's own background colors. The captions and alt text are in `store/google-play-screenshots.json`; paste each shot's `alt` into Play Console (140 at most, 104 to 116 used). The PNGs, the raw captures and the font are gitignored.

**Four are done** (2026-11-11), which is already enough: Play takes 2 to 8, and four or more at 9:16 make the app eligible for its recommendations. **05-colors and 06-audio are still to capture:** the emulator's own system died twice under the Mac's load (a load average of 350 to 580 and swap nearly full from other sessions' builds) before they could be taken. Capture them the way below when the Mac is quiet, then recompose; until then, upload the four.

| Shot | Caption | What it shows |
|---|---|---|
| 01-kaleidoscope | A Kaleidoscope You Can Touch / Push, pinch, twist, tilt and shake | Look `flower`, controls faded: magenta on indigo, the flower's center in view |
| 02-mirror | Mirror It Up to 12 Ways / Seven patterns, six line styles | Look `star`: yellow dashes on dark purple, four mirror lines with a gap |
| 03-beads | Beads That Bounce and Roll / Up to 150, pulled by gravity | Look `beads`, about 20 s after the seeded launch: 150 beads around the gravity well on a cyan spiral |
| 04-targets | Pick What Your Fingers Move / Pattern, mirror, gravity and more | Look `spiral` (controls stay up), the big bottom button tapped: the five gesture targets fanned out |
| 05-colors | Colors That Blend and Cycle / Pick a list, run it either way | To capture: look `spiral`, tap the palette button (fourth on the right, 984,646) |
| 06-audio | Let It Move to the Music / Turn on Audio Reactive in Settings | To capture: look `flower` with `'{"showLabels":true,"controlsAutoHideSpeed":0}'`, tap the gear (984,372). Auto-Hide Delay then reads Off (the iOS shot dragged it to the 5.0s default; either is a real setting) |

How they were made, so a reshoot can follow it:

1. A release APK for the emulator only: `CI=1 npx expo prebuild -p android --clean --no-install`, then add `debuggable true` at the top of `android/app/build.gradle`'s `release` block (AsyncStorage on Android is reachable only through `adb shell run-as`, which needs a debuggable app; React Native's own release config stays non-debug, so it still runs the bundled JavaScript, not Metro), and in `android/`, `./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a` (21 minutes from clean under heavy load, under a minute for a JS-only change). **Take the line out afterwards:** `android/` is gitignored, but a local build would use it, and Play refuses a debuggable bundle.
2. The shared `Pixel_9` emulator (`emulator -avd Pixel_9 -no-audio -no-boot-anim -no-snapshot-save`), dark mode (`adb shell cmd uimode night yes`), `adb shell settings put global hide_error_dialogs 1`, `adb install -r` the APK, and launch it once so its database exists.
3. `store/seed/reseed-android.sh <look> [extra settings json]` (the Android twin of `reseed.sh`: stops the app, writes the photosensitivity warning and guide as seen, sound off and the look into `databases/RKStorage`, and relaunches). The debuggable build takes 20 to 45 s to show the canvas after a reseed on a loaded Mac.
4. For 04 to 06 (the control sheets show the status bar), demo mode first, and again after anything restarts the emulator's system:
   ```bash
   adb shell settings put global sysui_demo_allowed 1
   adb shell am broadcast -a com.android.systemui.demo -e command enter
   adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
   adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false -e powersave false
   adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e fully true
   adb shell am broadcast -a com.android.systemui.demo -e command network -e mobile show -e level 4 -e datatype '' -e fully true
   adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
   ```
5. Captures with `adb exec-out screencap -p > store/screenshots/raw/android/<name>.png` (1080x2424), several a second or two apart while the colors cycle, keeping the best; taps with `adb shell input tap <x> <y>` in the screen's pixels (the big bottom button is at 540,2244).
6. `adb pull /system/fonts/Roboto-Regular.ttf store/screenshots/Roboto.ttf` (a variable font, so it draws the captions' bold), then `~/.claude/skills/app-store-prep/scripts/compose.mjs store/google-play-screenshots.json` writes `store/screenshots/android/` (it skips a shot with no capture).

## First run on Android (2026-11-11)

The first time Swirlio ran on Android: a local release APK (`com.infinitetoken.swirlio`, arm64, debuggable for seeding) on the Pixel_9 emulator (Android 16), in dark mode with sound off. Not a device, not the EAS production build.

- **It crashed on its first frame, now fixed:** `DashStyleIcon` passed `strokeDasharray={[]}` for the Solid line style (a fix for the cycle line type button staying dashed on iOS), and Android's `DashPathEffect` throws `ArrayIndexOutOfBoundsException` on fewer than two intervals. Solid is the default, so the bottom row's icon killed the app as soon as the controls drew. The Line is now keyed by its dash style and Solid passes no dasharray (`src/components/DashStyleIcon.tsx`, `src/__tests__/components/DashStyleIcon.test.tsx`). Not checked on iOS since: cycling back to Solid should now go solid there by remounting (iOS clears a recycled view's dasharray), but that wasn't run.
- **Worked:** a cold start to the photosensitivity warning and the How to Play guide over the canvas, Skia drawing every look full screen (flower, star with dashes, spiral with dash-dot, 150 beads around the gravity well), the controls coming back from a tap near the bottom edge, the trigger stack and bottom row, the line type cycling in place (Solid, Dots, Dashes), the gesture-target fan, the splash in dark mode, and the adaptive icon's resources.
- **ANRs under load, not traced to the app:** one tap during the line-type test timed out (5.4 s for a MotionEvent) while the emulator's CPU pressure was 87% with kswapd at 45% and Swirlio at 34%, and later the emulator's system server died outright (`DeadSystemException`), taking every app with it. The Mac's load average was 350 to 580 with swap nearly full from other sessions' builds. Worth a look on a device: Swirlio animates every frame, so it's heavier than the card games on a starved emulator.
- **Not checked:** the hardware and gesture back with a sheet open (the attempt was lost to the ANR), the colors and settings sheets, landscape, Audio Reactive and its permission prompt (the AVD has no audio), tilt and shake (no motion in the emulator), haptics, the launcher icon on screen, a tablet, a device.
