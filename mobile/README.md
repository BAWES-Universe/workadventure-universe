# BAWES Universe Mobile

This directory contains the shared Capacitor shell configuration for BAWES Universe.

The mobile app wraps the hosted Universe instance at `https://universe.bawes.net`.
It does not require a local WorkAdventure game server for normal mobile shell development.

## Scripts

Run these commands from this `mobile/` directory:

```sh
npm run doctor
npm run sync
npm run open:android
npm run open:ios
```

`npm run sync` should be used after a later platform issue adds `mobile/android/` or `mobile/ios/`.
This scaffold intentionally does not commit those platform folders.

## Next Steps

- Android platform setup is tracked in BAWES-Universe/workadventure-universe#4.
- iOS platform setup is tracked in BAWES-Universe/workadventure-universe#5.
