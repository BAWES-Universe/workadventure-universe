// @workadventure/noise-suppression 0.2.0 declares its entry points only in "exports", which TypeScript's "node"
// module resolution does not read. Point each entry point we import at its declaration file.
declare module "@workadventure/noise-suppression/audio-worklet" {
    export * from "@workadventure/noise-suppression/dist/audio-worklet";
}

declare module "@workadventure/noise-suppression/deepfilternet" {
    export * from "@workadventure/noise-suppression/dist/deepfilternet";
}

declare module "@workadventure/noise-suppression/vite" {
    export * from "@workadventure/noise-suppression/dist/vite";
}
