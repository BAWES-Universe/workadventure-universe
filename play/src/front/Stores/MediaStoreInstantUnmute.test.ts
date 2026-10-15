import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { writable } from "svelte/store";
import { AvailabilityStatus } from "@workadventure/messages";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
});

// Whether a live streaming space is on is decided by the game scene: let the tests decide it.
vi.mock("./IsStreamingStore", async () => {
    const { writable } = await import("svelte/store");
    return { isLiveStreamingStore: writable(false) };
});

const IPHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

interface FakeTrack {
    kind: "audio" | "video";
    readyState: "live" | "ended";
    enabled: boolean;
    stop(): void;
    getSettings(): Record<string, never>;
}

class FakeMediaStream {
    constructor(private tracks: FakeTrack[] = []) {}
    getAudioTracks = () => this.tracks.filter((track) => track.kind === "audio");
    getVideoTracks = () => this.tracks.filter((track) => track.kind === "video");
    getTracks = () => this.tracks;
    addTrack = (track: FakeTrack) => this.tracks.push(track);
    removeTrack = (track: FakeTrack) => {
        const index = this.tracks.indexOf(track);
        if (index >= 0) this.tracks.splice(index, 1);
    };
    addEventListener = () => undefined;
    removeEventListener = () => undefined;
}

/** The microphone and camera as the browser reports them: which were opened and closed, in order. */
function installFakeDevices(events: string[], tracks: FakeTrack[]) {
    vi.stubGlobal("MediaStream", FakeMediaStream);
    const newTrack = (kind: "audio" | "video"): FakeTrack => {
        const track: FakeTrack = {
            kind,
            readyState: "live",
            enabled: true,
            getSettings: () => ({}),
            stop() {
                this.readyState = "ended";
                events.push(`close ${kind}`);
            },
        };
        tracks.push(track);
        return track;
    };
    Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
            getUserMedia: (constraints: MediaStreamConstraints) => {
                events.push(`open ${constraints.audio ? "audio" : ""}${constraints.video ? "video" : ""}`);
                const opened: FakeTrack[] = [];
                if (constraints.audio) opened.push(newTrack("audio"));
                if (constraints.video) opened.push(newTrack("video"));
                return Promise.resolve(new FakeMediaStream(opened));
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

describe("muting the microphone during a conversation", { timeout: 60_000 }, () => {
    let events: string[];
    let tracks: FakeTrack[];

    beforeEach(() => {
        // The module starts timers when it is loaded: they must be the fake ones.
        vi.useFakeTimers();
        vi.resetModules();
        events = [];
        tracks = [];
        installFakeDevices(events, tracks);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    async function enterGame(userAgent: string, platform: string) {
        setDevice(userAgent, platform);
        const media = await import("./MediaStore");
        const { myCameraStore, myMicrophoneStore } = await import("./MyMediaStore");
        const { isLiveStreamingStore } = (await import("./IsStreamingStore")) as unknown as {
            isLiveStreamingStore: ReturnType<typeof writable<boolean>>;
        };
        myMicrophoneStore.set(true);
        myCameraStore.set(true);
        // Energy saving would close the devices after a few seconds alone, which is not what is tested here.
        media.cameraNoEnergySavingStore.set(true);
        media.requestedMicrophoneState.enableMicrophone();
        let localStream: MediaStream | undefined;
        const unsubscribe = media.localStreamStore.subscribe((value) => {
            if (value.type === "success") localStream = value.stream;
        });
        const wait = (seconds: number) => vi.advanceTimersByTimeAsync(seconds * 1000);
        await wait(15);
        return {
            media,
            myMicrophoneStore,
            setLive: (live: boolean) => isLiveStreamingStore.set(live),
            mute: () => media.requestedMicrophoneState.disableMicrophone(),
            unmute: () => media.requestedMicrophoneState.enableMicrophone(),
            audioTracksInStream: () => localStream?.getAudioTracks().length ?? 0,
            videoTracksInStream: () => localStream?.getVideoTracks().length ?? 0,
            wait,
            unsubscribe,
        };
    }

    // The devices are opened more than once while the game starts: the one in use is the last one.
    const audioTrack = () => tracks.filter((track) => track.kind === "audio").at(-1);

    it.each([
        ["on a computer", DESKTOP_UA, "Win32"],
        ["on a phone", IPHONE_UA, "iPhone"],
    ])("keeps the track open and unmutes without reopening the device %s", async (_name, userAgent, platform) => {
        const game = await enterGame(userAgent, platform);
        game.setLive(true);
        await game.wait(3);
        const track = audioTrack();
        expect(track).toBeDefined();
        expect(game.audioTracksInStream()).toBe(1);
        events.length = 0;

        game.mute();
        await game.wait(3);

        expect(events).toEqual([]);
        expect(track?.readyState).toBe("live");
        expect(track?.enabled).toBe(false);
        expect(game.audioTracksInStream()).toBe(0);

        game.unmute();
        await game.wait(3);

        expect(events).toEqual([]);
        expect(track?.enabled).toBe(true);
        expect(track?.readyState).toBe("live");
        expect(game.audioTracksInStream()).toBe(1);
        game.unsubscribe();
    });

    it("unmutes instantly even when the camera is turned on at the same moment", async () => {
        const game = await enterGame(DESKTOP_UA, "Win32");
        game.setLive(true);
        await game.wait(3);
        game.media.requestedCameraState.disableWebcam();
        game.mute();
        await game.wait(3);
        const track = audioTrack();
        expect(game.videoTracksInStream()).toBe(0);
        events.length = 0;

        game.media.requestedCameraState.enableWebcam();
        game.unmute();
        await game.wait(3);

        expect(events).toEqual(["open video"]);
        expect(track?.readyState).toBe("live");
        expect(track?.enabled).toBe(true);
        expect(game.audioTracksInStream()).toBe(1);
        expect(game.videoTracksInStream()).toBe(1);
        game.unsubscribe();
    });

    it("also keeps the track open in a meeting room", async () => {
        const game = await enterGame(DESKTOP_UA, "Win32");
        game.media.inLivekitStore.set(true);
        await game.wait(3);
        events.length = 0;

        game.mute();
        await game.wait(3);
        game.unmute();
        await game.wait(3);

        expect(events).toEqual([]);
        expect(audioTrack()?.enabled).toBe(true);
        game.unsubscribe();
    });

    it("stops the muted track when the conversation ends", async () => {
        const game = await enterGame(DESKTOP_UA, "Win32");
        game.setLive(true);
        await game.wait(3);
        game.mute();
        await game.wait(3);
        expect(audioTrack()?.readyState).toBe("live");
        events.length = 0;

        game.setLive(false);
        await game.wait(3);

        expect(events).toContain("close audio");
        expect(audioTrack()?.readyState).toBe("ended");
        game.unsubscribe();
    });

    it("reopens the device when unmuting after the conversation ended", async () => {
        const game = await enterGame(DESKTOP_UA, "Win32");
        game.setLive(true);
        await game.wait(3);
        game.mute();
        await game.wait(3);
        game.setLive(false);
        await game.wait(3);
        events.length = 0;

        game.unmute();
        await game.wait(3);

        expect(events).toContain("open audio");
        expect(game.audioTracksInStream()).toBe(1);
        game.unsubscribe();
    });

    it("stops the track at once when not in a conversation", async () => {
        const game = await enterGame(DESKTOP_UA, "Win32");
        await game.wait(3);
        const track = audioTrack();
        expect(track?.readyState).toBe("live");
        events.length = 0;

        game.mute();
        await game.wait(3);

        expect(events).toContain("close audio");
        expect(track?.readyState).toBe("ended");
        expect(game.audioTracksInStream()).toBe(0);
        game.unsubscribe();
    });

    it("stops the muted track when another microphone is picked", async () => {
        const game = await enterGame(DESKTOP_UA, "Win32");
        game.setLive(true);
        await game.wait(3);
        game.mute();
        await game.wait(3);
        const track = audioTrack();
        expect(track?.readyState).toBe("live");
        events.length = 0;

        game.media.requestedMicrophoneDeviceIdStore.set("other-mic");
        await game.wait(3);

        // Still muted: the old microphone is released and nothing is opened.
        expect(events).toEqual(["close audio"]);
        expect(track?.readyState).toBe("ended");

        game.unmute();
        await game.wait(3);
        expect(events).toContain("open audio");
        game.unsubscribe();
    });

    it("stops the muted track when the status cuts the microphone", async () => {
        const game = await enterGame(DESKTOP_UA, "Win32");
        game.setLive(true);
        await game.wait(3);
        game.mute();
        await game.wait(3);
        expect(audioTrack()?.readyState).toBe("live");
        events.length = 0;

        game.media.requestedStatusStore.set(AvailabilityStatus.DO_NOT_DISTURB);
        await game.wait(3);

        expect(events).toContain("close audio");
        expect(audioTrack()?.readyState).toBe("ended");
        game.unsubscribe();
    });

    it("stops the track when something else than the user cuts the microphone", async () => {
        const game = await enterGame(DESKTOP_UA, "Win32");
        game.setLive(true);
        await game.wait(3);
        events.length = 0;

        // Not a mute by the user (for example an external service uses the microphone): really released.
        game.myMicrophoneStore.set(false);
        await game.wait(3);

        expect(events).toContain("close audio");
        expect(audioTrack()?.readyState).toBe("ended");
        game.unsubscribe();
    });
});
