# BAWES Universe Mobile

This directory contains the shared Capacitor configuration for the BAWES Universe native mobile shell.

The app loads `https://universe.bawes.net` directly, so no local WorkAdventure game server is required for the mobile shell configuration.

## Scripts

Install dependencies first:

```bash
npm install
```

Validate the Capacitor setup:

```bash
npm run cap:doctor
```

After the Android or iOS platform folders are added by the follow-up tasks, sync native projects with:

```bash
npm run cap:sync
```

Open a generated platform project:

```bash
npm run cap:open:android
npm run cap:open:ios
```

## Follow-Up Tasks

- Android platform, signing, and release artifact: https://github.com/BAWES-Universe/workadventure-universe/issues/4
- iOS platform, signing, and TestFlight setup: https://github.com/BAWES-Universe/workadventure-universe/issues/5

This scaffold intentionally does not commit `android/` or `ios/`; those platform folders are owned by the follow-up issues.
