import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";
import { Subject } from "rxjs";

vi.mock("../../../../Enum/EnvironmentVariable.ts", () => ({
    PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH: 0,
    PEER_VIDEO_RECOMMENDED_BANDWIDTH: 0,
    MAX_USERNAME_LENGTH: 10,
}));
vi.mock("../../../../WebRtc/BlackListManager", () => {
    const noEvents = { subscribe: () => ({ unsubscribe: () => undefined }) };
    return { blackListManager: { isBlackListed: () => false, onBlockStream: noEvents, onUnBlockStream: noEvents } };
});
const { resumeAll, microphone } = vi.hoisted(() => {
    let on = true;
    const listeners = new Set<(value: boolean) => void>();
    return {
        resumeAll: vi.fn().mockResolvedValue(undefined),
        microphone: {
            subscribe(run: (value: boolean) => void) {
                listeners.add(run);
                run(on);
                return () => listeners.delete(run);
            },
            set(value: boolean) {
                on = value;
                listeners.forEach((run) => run(on));
            },
        },
    };
});
const { cues } = vi.hoisted(() => ({ cues: [] as string[] }));
vi.mock("../../../Bots/VoiceCues", () => ({ playVoiceCue: (cue: string) => cues.push(cue) }));
vi.mock("../../../../WebRtc/AudioContextManager", () => ({ audioContextManager: { resumeAll: () => resumeAll() } }));
vi.mock("../../../../Stores/MediaStore", () => ({
    requestedMicrophoneState: { subscribe: (run: (value: boolean) => void) => microphone.subscribe(run) },
}));
// The real English wording: {name} and {name:type} are filled in from what the call gives.
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { default: say } = await import("../../../../../i18n/en-US/say");
    const walk = (path: string[]): unknown =>
        new Proxy(() => undefined, {
            get: (_target, key: string) => walk([...path, key]),
            apply: (_target, _this, [args]: [Record<string, unknown> | undefined]) => {
                const text = path.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], {
                    say,
                }) as string;
                return text
                    .replace(/\{\{([^|}]+)\|([^}]+)\}\}/g, (_all, one: string, other: string) =>
                        args?.count === 1 ? one : other
                    )
                    .replace(/\{(\w+)(?::\w+)?\}/g, (_all, key: string) => String(args?.[key]));
            },
        });
    return { default: readable(walk([])), locale: readable("en-US") };
});

import type { SpaceInterface, SpaceUserExtended } from "../../../../Space/SpaceInterface";
import { trackVoiceSpace, voiceChoiceStore, watchBotAudio } from "../../../Bots/VoiceBots";
import SpokenReplyControl from "../SpokenReplyControl.svelte";
import VoiceListeningRow from "../VoiceListeningRow.svelte";

/**
 * Round 8 in nearby chat: Stop speaking (or Play <bot>'s audio) inside the reply being heard, and the row with Stop
 * listening above the message box while the bot takes this person's microphone in the group.
 */
const user = (spaceUserId: string, extra: object = {}) =>
    ({
        spaceUserId,
        uuid: `uuid-${spaceUserId}`,
        tags: [],
        name: spaceUserId,
        pictureStore: readable("woka.png"),
        ...extra,
    } as unknown as SpaceUserExtended);
const nora = user("b1", { uuid: "bot-1", tags: ["bot", "voice-bot"], name: "Nora" });

function fakeSpace() {
    const users = writable(new Map<string, SpaceUserExtended>([["me", user("me")]]));
    const statuses = new Subject<unknown>();
    const streams = new Subject<unknown>();
    const space = {
        getName: () => "bubble-1",
        mySpaceUserId: "me",
        destroyed: false,
        usersStore: users,
        observePrivateEvent: () => statuses,
        observePublicEvent: () => streams,
        emitPrivateMessage: vi.fn(),
    } as unknown as SpaceInterface;
    return {
        space,
        join: (...others: SpaceUserExtended[]) =>
            users.set(new Map([user("me"), ...others].map((u) => [u.spaceUserId, u]))),
        say: (extra: object = {}) =>
            statuses.next({
                $case: "botVoiceStatus",
                sender: nora,
                botVoiceStatus: { botId: "1", botName: "Nora", state: "on", followUpSeconds: 30, ...extra },
            }),
        speak: (responseId: string, speaking: boolean) =>
            streams.next({
                $case: "spaceStreamMessage",
                sender: "b1",
                spaceStreamMessage: { responseId, token: "", isFinal: true, isError: false, reset: false, speaking },
            }),
        sent: () =>
            (space.emitPrivateMessage as ReturnType<typeof vi.fn>).mock.calls.map(
                ([message]) => (message as { voiceModeChoice: { listen: string; stopSpeaking: string } }).voiceModeChoice
            ),
    };
}

const settle = async () => {
    await tick();
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
    await tick();
};

describe("voice in nearby chat (round 8)", () => {
    let target: HTMLElement;
    let stop: (() => void) | undefined;
    let t: ReturnType<typeof fakeSpace>;
    const destroy: (() => void)[] = [];

    beforeEach(() => {
        localStorage.clear();
        voiceChoiceStore.choose("talk");
        microphone.set(true);
        target = document.createElement("div");
        document.body.appendChild(target);
        t = fakeSpace();
        stop = trackVoiceSpace(t.space);
        t.join(nora, user("p2", { name: "Mishari" }));
    });
    afterEach(() => {
        destroy.splice(0).forEach((d) => d());
        stop?.();
        document.body.innerHTML = "";
    });

    describe("the reply being heard", () => {
        const mount = (responseId = "r1") => {
            const component = new SpokenReplyControl({ target, props: { reply: { responseId, botSpaceUserId: "b1" } } });
            destroy.push(() => component.$destroy());
        };
        const control = () => target.querySelector<HTMLElement>("[data-testid=spokenReply]");

        it("shows Stop speaking only while this reply is heard, and a tap stops only the reply", async () => {
            mount("r1");
            t.say();
            await settle();
            expect(control()).toBeNull();
            t.speak("r2", true);
            await settle();
            expect(control()).toBeNull();
            t.speak("r1", true);
            await settle();
            expect(control()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Speaking Stop speaking");
            target.querySelector<HTMLButtonElement>("[data-testid=spokenReplyStop]")!.click();
            await settle();
            expect(t.sent().pop()).toEqual({ mode: "talk", listen: "", stopSpeaking: "r1" });
            expect(control()).toBeNull();
        });

        it("goes when the audio is over, and never shows for someone who doesn't hear bots", async () => {
            mount("r1");
            t.say();
            t.speak("r1", true);
            await settle();
            expect(control()).not.toBeNull();
            t.speak("r1", false);
            await settle();
            expect(control()).toBeNull();
            voiceChoiceStore.choose("text_only");
            t.speak("r1", true);
            await settle();
            expect(control()).toBeNull();
            voiceChoiceStore.choose("speak_and_read");
            await settle();
            expect(control()).toBeNull();
        });

        it("says Play Nora's audio when the browser blocked the sound: one tap tries it, and never asks to listen", async () => {
            mount("r1");
            t.say({ listening: "off", listeningReason: "others_joined" });
            t.speak("r1", true);
            const element = {
                srcObject: {},
                play: vi.fn().mockRejectedValue(Object.assign(new Error("blocked"), { name: "NotAllowedError" })),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            };
            const unwatch = watchBotAudio("b1", element as unknown as HTMLMediaElement);
            try {
                await settle();
                const play = target.querySelector<HTMLButtonElement>("[data-testid=spokenReplyPlay]")!;
                expect(play.textContent?.trim()).toBe("Play \u2068Nora\u2069's audio");
                element.play.mockClear();
                element.play.mockResolvedValue(undefined);
                const before = t.sent().length;
                play.click();
                expect(element.play).toHaveBeenCalledTimes(1);
                await settle();
                expect(t.sent()).toHaveLength(before);
                // The sound plays: the same place stops it now
                expect(target.querySelector("[data-testid=spokenReplyPlay]")).toBeNull();
                expect(target.querySelector("[data-testid=spokenReplyStop]")).not.toBeNull();
            } finally {
                unwatch();
            }
        });
    });

    describe("the row above the message box", () => {
        const mount = () => {
            const component = new VoiceListeningRow({ target });
            destroy.push(() => component.$destroy());
        };
        const row = () => target.querySelector<HTMLElement>("[data-testid=voiceListeningRow]");
        const text = () => row()?.textContent?.replace(/\s+/g, " ").trim();

        it("shows nothing alone, nor while the bot doesn't listen", async () => {
            mount();
            t.say();
            await settle();
            expect(row()).toBeNull();
            t.say({ listening: "off", listeningReason: "others_joined" });
            await settle();
            expect(row()).toBeNull();
        });

        it("says it listens, with Stop listening, and Cancel while it turns on", async () => {
            mount();
            t.say({ listening: "pending" });
            await settle();
            expect(text()).toBe("Nora Turning on… Cancel");
            t.say({ listening: "on" });
            await settle();
            expect(text()).toBe("Nora Listening to you Stop listening");
            expect(row()?.getAttribute("aria-label")).toBe("Nora: Listening to you");
            target.querySelector<HTMLButtonElement>("[data-testid=voiceListeningRowStop]")!.click();
            await settle();
            expect(t.sent().pop()).toMatchObject({ listen: "stop" });
        });

        it("says it may still hear you while a stop is not confirmed, and lets you ask again", async () => {
            mount();
            t.say({ listening: "stopping" });
            await settle();
            expect(text()).toBe("Nora Stopping…");
            t.say({ listening: "checking" });
            await settle();
            expect(text()).toBe("Nora Checking connection · it may still hear you Stop listening");
            t.say({ listening: "off" });
            await settle();
            expect(row()).toBeNull();
        });
    });
});
