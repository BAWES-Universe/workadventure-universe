import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writable } from "svelte/store";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
});

const IPHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

interface FakeTrack {
    kind: "audio" | "video";
    readyState: "live" | "ended";
    stop(): void;
    getSettings(): Record<string, never>;
}

/** The microphone and camera as the browser reports them: which were opened and closed, in order. */
function installFakeDevices(events: string[], answers: { hold: boolean; waiting: (() => void)[] }) {
    const newTrack = (kind: "audio" | "video"): FakeTrack => ({
        kind,
        readyState: "live",
        getSettings: () => ({}),
        stop() {
            this.readyState = "ended";
            events.push(`close ${kind}`);
        },
    });
    const newStream = (constraints: MediaStreamConstraints) => {
        const tracks: FakeTrack[] = [];
        if (constraints.audio) tracks.push(newTrack("audio"));
        if (constraints.video) tracks.push(newTrack("video"));
        return {
            getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
            getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
            getTracks: () => tracks,
            addTrack: (track: FakeTrack) => tracks.push(track),
            removeTrack: (track: FakeTrack) => {
                const index = tracks.indexOf(track);
                if (index >= 0) tracks.splice(index, 1);
            },
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        };
    };
    Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
            getUserMedia: (constraints: MediaStreamConstraints) => {
                events.push(`open ${constraints.audio ? "audio" : ""}${constraints.video ? "video" : ""}`);
                // While "hold" is on, the browser keeps asking until the test answers.
                if (answers.hold) {
                    return new Promise((resolve) => {
                        answers.waiting.push(() => resolve(newStream(constraints)));
                    });
                }
                return Promise.resolve(newStream(constraints));
            },
            enumerateDevices: () =>
                Promise.resolve([
                    { deviceId: "mic", kind: "audioinput", label: "Microphone", groupId: "a", toJSON: () => ({}) },
                    { deviceId: "cam", kind: "videoinput", label: "Camera", groupId: "b", toJSON: () => ({}) },
                ]),
            getSupportedConstraints: () => ({ deviceId: true }),
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        },
    });
}

function setDevice(userAgent: string, platform: string) {
    Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
    Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
}

function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
}

describe("the microphone on a phone", { timeout: 60_000 }, () => {
    let events: string[];
    let answers: { hold: boolean; waiting: (() => void)[] };

    beforeEach(() => {
        vi.resetModules();
        events = [];
        answers = { hold: false, waiting: [] };
        installFakeDevices(events, answers);
    });

    afterEach(() => {
        setVisibility("visible");
        vi.useRealTimers();
    });

    async function enterGame() {
        const media = await import("./MediaStore");
        const { myCameraStore, myMicrophoneStore } = await import("./MyMediaStore");
        const peers = await import("./PeerStore");
        vi.useFakeTimers();
        myMicrophoneStore.set(true);
        myCameraStore.set(true);
        const unsubscribe = media.localStreamStore.subscribe(() => undefined);
        const wait = (seconds: number) => vi.advanceTimersByTimeAsync(seconds * 1000);
        const setPeers = (count: number) =>
            peers.videoStreamStore.forward(
                writable(new Map(Array.from({ length: count }, (_, i) => [`peer${i}`, {}]))) as never
            );
        await wait(15);
        return { wait, setPeers, unsubscribe };
    }

    it("stays closed when you leave the app and come back with nobody near", async () => {
        setDevice(IPHONE_UA, "iPhone");
        const { wait, unsubscribe } = await enterGame();
        events.length = 0;

        setVisibility("hidden");
        await wait(20);
        setVisibility("visible");
        await wait(5);

        expect(events.filter((event) => event.includes("audio"))).toEqual([]);
        unsubscribe();
    });

    it("opens when someone joins the bubble, stays open while away in the bubble, and closes when they leave", async () => {
        setDevice(IPHONE_UA, "iPhone");
        const { wait, setPeers, unsubscribe } = await enterGame();
        events.length = 0;

        setPeers(1);
        await wait(3);
        expect(events).toContain("open audio");

        events.length = 0;
        setVisibility("hidden");
        await wait(5);
        setVisibility("visible");
        await wait(3);
        expect(events.filter((event) => event.includes("audio"))).toEqual([]);

        setPeers(0);
        await wait(3);
        expect(events).toContain("close audio");
        unsubscribe();
    });

    it("closes the microphone when the bubble ends before the browser has answered", async () => {
        setDevice(IPHONE_UA, "iPhone");
        const { wait, setPeers, unsubscribe } = await enterGame();
        events.length = 0;

        answers.hold = true;
        setPeers(1);
        await wait(1);
        expect(events).toContain("open audio");
        setPeers(0);
        await wait(1);

        // The browser answers late, with a microphone nobody wants any more.
        answers.hold = false;
        answers.waiting.forEach((answer) => answer());
        await wait(1);

        expect(events).toContain("close audio");
        unsubscribe();
    });

    it("is unchanged on a computer: open while alone", async () => {
        setDevice(DESKTOP_UA, "Win32");
        const { unsubscribe } = await enterGame();

        expect(events.some((event) => event.startsWith("open audio"))).toBe(true);
        unsubscribe();
    });
});
