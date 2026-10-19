# App Store

Everything the iOS listing needs. The text lives in `store.config.json` (repo root), which `eas metadata:push` sends to App Store Connect. The rest is set by hand in App Store Connect once and carries over to later versions.

## Pushed by EAS Metadata (`store.config.json`)

Title, subtitle, promotional text, description, keywords, marketing/support/privacy URLs, copyright, category (Entertainment: there's nothing to win, so not Games) and the age rating answers (all None, so 4+).

```bash
eas metadata:lint
```

```bash
eas metadata:push
```

`push` needs the app record to exist in App Store Connect and edits the version matching `app.json`'s `expo.version`. The first `eas submit` creates the record (named by `eas.json`'s `submit.production.ios.appName`) when you sign in with your Apple ID. Apple's API can't create apps, so with an API key create it first: My Apps > + > New App, bundle ID `com.infinitetoken.Swirlio`, name `Swirlio`, primary language English (U.S.).

Limits: title 30, subtitle 30, promotional text 170 (editable any time without review), description 4000, keywords 100 in total with the commas. Keywords don't repeat words already in the title or subtitle ("swirlio", "kaleidoscope", "fidget" and "toy" are indexed from those). Swirlio isn't a Tastic game, so the name has no "Tastic".

The three URLs are this app's own web deployment (see "Web" in `.claude/CLAUDE.md`): `public/privacy.html` and `public/support.html` are served at `/privacy` and `/support`. They must be live before review, since the reviewer opens them.

`releaseNotes` (What's New) is left out for the first version, which has none. Add it to `info.en-US` for every later version.

## Screenshots (uploaded by hand)

Not made yet. `store/screenshots/iphone/` (6.9", 1320x2868) and `store/screenshots/ipad/` (13", 2064x2752), made with Jay's `app-store-prep` skill. The iPad set is required because `ios.supportsTablet` is on. The order in the folder is the upload order; the first three are what search results show.

The PNGs will be build output and gitignored, along with the raw captures they're made from (`store/screenshots/raw/`). The captions go in `store/screenshots.json`.

## Set by hand in App Store Connect

**App Privacy:** "No, we don't collect data from this app" (Data Not Collected). Audio Reactive reads the microphone, and tilt and shake read the motion sensors, but both are processed in memory on the device and never stored or sent, which Apple doesn't count as collection. Settings and look history stay in on-device storage. Nothing leaves the device except the Expo update check, which carries no personal data (the app version, platform and a random installation ID used to serve the right update), and there is no tracking, so no App Tracking Transparency prompt either. This matches the privacy policy at https://swirlio.infinitetoken.com/privacy. Revisit it if analytics, crash reporting, ads or accounts are ever added.

**App Review Information:** sign-in not required. Contact: name, email and phone (the phone stays out of `store.config.json`, which is public). Notes:

> No account or sign-in is needed, and there are no in-app purchases or ads.
>
> Swirlio is a kaleidoscope toy with no goal. Drag, pinch, twist and tap the screen to play with the pattern. The on-screen controls fade out after a few seconds; tap the bottom edge or the top right corner to bring them back.
>
> The microphone is only requested when Audio Reactive is turned on in Settings. The app measures the sound level in memory to move the pattern and never records or sends audio. The motion sensors drive Tilt and Shake to Randomize.
>
> On first launch a photosensitivity warning appears (tap I Understand), followed by a five-card How to Play guide (tap Skip to go straight to the app).

**Content Rights:** no third-party artwork. The icon font is MaterialCommunityIcons through `@expo/vector-icons` (Apache 2.0). The three interface sounds in `assets/sounds/` (typewriter, shutter, relay) come from Jay's `Sounds` folder; confirm they're original recordings, or note their source here, before answering "no third-party content".

**Pricing and Availability:** Free, all territories.

**Export compliance:** already answered by `ITSAppUsesNonExemptEncryption: false` in `app.json`, so App Store Connect doesn't ask.

**Accessibility (optional):** leave blank until each feature has been checked on a device. Apple asks per feature (VoiceOver, Larger Text, Dark Interface, Reduced Motion and so on), and a claim that doesn't hold up is worse than none.

**Version release:** automatic after approval, or manual (you press Release). Manual is the safer choice for the first version.

## Shipping a version

1. `npm run verify`
2. `jrd ship build production`
3. `eas submit -p ios --profile production` (uploads the build to TestFlight)
4. `eas metadata:push`
5. Upload the screenshots if they changed
6. In App Store Connect: pick the build, fill in anything new above, and Add for Review
