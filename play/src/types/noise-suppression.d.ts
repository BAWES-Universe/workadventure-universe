// The package only declares its entry points through "exports", which this project's "node" module resolution
// doesn't read. Vite resolves them at build time; these lines give TypeScript the same types.
declare module "@workadventure/noise-suppression/audio-worklet" {
    export * from "@workadventure/noise-suppression/dist/audio-worklet";
}

declare module "@workadventure/noise-suppression/vite" {
    export * from "@workadventure/noise-suppression/dist/vite";
}
