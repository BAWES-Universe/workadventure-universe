import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, readable, writable } from "svelte/store";
import { Subject } from "rxjs";

vi.mock("../../../Enum/EnvironmentVariable.ts", () => ({
    PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH: 0,
    PEER_VIDEO_RECOMMENDED_BANDWIDTH: 0,
    MAX_USERNAME_LENGTH: 10,
}));
vi.mock("../../../WebRtc/BlackListManager", () => {
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
vi.mock("../../../Chat/Bots/VoiceCues", () => ({ playVoiceCue: (cue: string) => cues.push(cue) }));
vi.mock("../../../WebRtc/AudioContextManager", () => ({ audioContextManager: { resumeAll: () => resumeAll() } }));
vi.mock("../../../Stores/MediaStore", () => ({
    requestedMicrophoneState: { subscribe: (run: (value: boolean) => void) => microphone.subscribe(run) },
}));
// The real English wording: {name} and {name:type} are filled in from what the call gives.
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { default: say } = await import("../../../../i18n/en-US/say");
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

import type { SpaceInterface, SpaceUserExtended } from "../../../Space/SpaceInterface";
import { trackVoiceSpace, voiceChoiceStore, watchBotAudio } from "../../../Chat/Bots/VoiceBots";
import VoiceButton from "./VoiceButton.svelte";

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
        say: (state: string, followUpSeconds = 0, extra: object = {}) =>
            statuses.next({
                $case: "botVoiceStatus",
                sender: nora,
                botVoiceStatus: { botId: "1", botName: "Nora", state, followUpSeconds, ...extra },
            }),
        speak: (responseId: string, speaking: boolean) =>
            streams.next({
                $case: "spaceStreamMessage",
                sender: "b1",
                spaceStreamMessage: { responseId, token: "", isFinal: true, isError: false, reset: false, speaking },
            }),
    };
}

const settle = async () => {
    await tick();
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
    await tick();
};

describe("the Voice button", () => {
    let component: VoiceButton | undefined;
    let target: HTMLElement;
    let stop: (() => void) | undefined;
    let t: ReturnType<typeof fakeSpace>;
    const button = () => target.querySelector<HTMLButtonElement>("[data-testid=voice-button]")!;
    const label = () => button().getAttribute("aria-label");

    beforeEach(() => {
        localStorage.clear();
        voiceChoiceStore.choose("talk");
        microphone.set(true);
        target = document.createElement("div");
        document.body.appendChild(target);
        t = fakeSpace();
        stop = trackVoiceSpace(t.space);
        component = new VoiceButton({ target });
    });
    afterEach(() => {
        component?.$destroy();
        stop?.();
        document.body.innerHTML = "";
    });

    it("is not available, and not reachable by keyboard, without a voice bot", async () => {
        await settle();
        expect(button().disabled).toBe(true);
        expect(button().tabIndex).toBe(-1);
        expect(target.querySelector(".voice-slot")?.getAttribute("aria-hidden")).toBe("true");
        expect(target.querySelector("[data-testid=voice-announce]")?.textContent).toBe("");
    });

    it("is not there for a text-only bot", async () => {
        t.join(user("b2", { uuid: "bot-2", tags: ["bot"], name: "Echo" }));
        await settle();
        expect(button().disabled).toBe(true);
    });

    it("says each state in words, with the mark for it, and announces the change", async () => {
        t.join(nora);
        await settle();
        expect(label()).toBe("Voice with Nora: connecting");
        expect(target.querySelector("[data-testid=voice-connecting]")).not.toBeNull();
        expect(button().disabled).toBe(false);
        expect(target.querySelector("[data-testid=voice-announce]")?.textContent).toBe("Voice with Nora: connecting");

        t.say("on");
        await settle();
        expect(label()).toBe("Voice with Nora: talk and listen");
        expect(button().dataset.state).toBe("talk");
        expect(target.querySelector(".mark")).not.toBeNull();
        expect(target.querySelector("[data-testid=voice-connecting]")).toBeNull();

        const choose = async (choice: "speak_and_read" | "type_and_listen" | "text_only", words: string) => {
            voiceChoiceStore.choose(choice);
            await settle();
            expect(label()).toBe(words);
            expect(target.querySelector("[data-testid=voice-announce]")?.textContent).toBe(words);
        };
        await choose("speak_and_read", "Voice with Nora: speak and read");
        await choose("type_and_listen", "Voice with Nora: type and listen");
        await choose("text_only", "Voice with Nora: text only");
        expect(button().classList.contains("dim")).toBe(true);

        t.say("paused");
        await settle();
        expect(label()).toBe("Voice with Nora: voice paused");
        expect(button().classList.contains("dim")).toBe(true);
    });

    it("says the sound is blocked, opens the options quietly on a tap, and plays the sound only from Play bot audio (round 8)", async () => {
        t.join(nora);
        t.say("on");
        const element = {
            srcObject: {},
            play: vi.fn().mockRejectedValue(Object.assign(new Error("blocked"), { name: "NotAllowedError" })),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };
        const unwatch = watchBotAudio("b1", element as unknown as HTMLMediaElement);
        try {
            await settle();
            expect(label()).toBe("Voice with Nora: tap to hear");
            element.play.mockClear();
            // Opening the options is quiet: no sound starts
            button().click();
            await settle();
            expect(element.play).not.toHaveBeenCalled();
            expect(target.querySelector("[data-testid=voice-menu]")).not.toBeNull();
            const play = target.querySelector<HTMLButtonElement>("[data-testid=voice-play-audio]")!;
            expect(play.textContent?.trim()).toBe("Play bot audio");
            expect(document.activeElement).toBe(play);
            // Its own tap starts it; it stays offered until the sound really plays
            play.click();
            expect(element.play).toHaveBeenCalledTimes(1);
            expect(resumeAll).toHaveBeenCalled();
            await settle();
            expect(target.querySelector("[data-testid=voice-play-audio]")).not.toBeNull();
            element.play.mockResolvedValue(undefined);
            target.querySelector<HTMLButtonElement>("[data-testid=voice-play-audio]")!.click();
            await settle();
            expect(target.querySelector("[data-testid=voice-play-audio]")).toBeNull();
            expect(label()).toBe("Voice with Nora: talk and listen");
        } finally {
            unwatch();
        }
    });

    describe("its menu", () => {
        const menu = () => target.querySelector<HTMLElement>("[data-testid=voice-menu]");
        const row = (choice: string) =>
            target.querySelector<HTMLButtonElement>(`[data-testid=voice-choice-${choice}]`)!;

        beforeEach(async () => {
            t.join(nora);
            t.say("on");
            await settle();
        });

        it("opens on the tap, on the row you have, with four rows and the one line that is always true", async () => {
            button().click();
            await settle();
            expect(menu()).not.toBeNull();
            expect(button().getAttribute("aria-expanded")).toBe("true");
            expect(
                [...target.querySelectorAll("[role=menuitemradio]")].map((r) =>
                    r.textContent?.replace(/\s+/g, " ").trim()
                )
            ).toEqual([
                "Talk and listen Bots hear you when your mic is on",
                "Speak and read Bots hear you, you read their words",
                "Type and listen You type, you hear them",
                "Text only No bot voice for you, chat as usual",
            ]);
            expect(row("talk").getAttribute("aria-checked")).toBe("true");
            expect(document.activeElement).toBe(row("talk"));
            expect(target.querySelector("[data-testid=voice-menu-foot]")?.textContent?.trim()).toBe(
                "Your microphone with people doesn't change."
            );
            expect(target.querySelector("[data-testid=voice-menu-status]")?.textContent?.trim()).toBe("In your bubble");
            expect(target.querySelector("[data-testid=voice-menu-attention]")).toBeNull();
        });

        it("says how to get the bot's attention only when other people are here, and the seconds only when the bot said them", async () => {
            t.join(nora, user("sara"));
            button().click();
            await settle();
            const attention = target
                .querySelector("[data-testid=voice-menu-attention]")
                ?.textContent?.replace(/\s+/g, " ")
                .trim();
            expect(attention).toBe(
                "With others here, use its name when you talk or type to it, like “Nora, what do you think?”"
            );
            expect(target.querySelector("[data-testid=voice-menu-status]")?.textContent?.trim()).toBe(
                "In your bubble · 3 people"
            );

            t.say("on", 30);
            await settle();
            const withSeconds = target
                .querySelector("[data-testid=voice-menu-attention]")
                ?.textContent?.replace(/\s+/g, " ")
                .trim();
            expect(withSeconds).toBe(
                "With others here, use its name when you talk or type to it, like “Nora, what do you think?” After it answers, you have 30 seconds to keep going without the name. Done sooner? Just tell it, like “Stop” or “We're done”."
            );
        });

        it("chooses a row for you alone, and keeps it", async () => {
            button().click();
            await settle();
            row("type_and_listen").click();
            await settle();
            expect(get(voiceChoiceStore)).toBe("type_and_listen");
            expect(row("type_and_listen").getAttribute("aria-checked")).toBe("true");
            expect(row("talk").getAttribute("aria-checked")).toBe("false");
            expect(localStorage.getItem("voiceChoice")).toBe("type_and_listen");
        });

        it("moves between rows with the arrows, closes with Escape and gives the focus back to the button", async () => {
            button().click();
            await settle();
            row("talk").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
            expect(document.activeElement).toBe(row("speak_and_read"));
            row("speak_and_read").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
            row("talk").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
            expect(document.activeElement).toBe(row("text_only"));
            row("text_only").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            await settle();
            expect(menu()).toBeNull();
            expect(document.activeElement).toBe(button());
        });

        it("closes when you tap the button again, or tap outside", async () => {
            button().click();
            await settle();
            button().click();
            await settle();
            expect(menu()).toBeNull();
            button().click();
            await settle();
            document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
            await settle();
            expect(menu()).toBeNull();
        });

        it("closes when the focus tabs from the menu onto the button, but a press on the button still closes it once", async () => {
            button().click();
            await settle();
            row("talk").dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: button() }));
            await settle();
            expect(menu()).toBeNull();
            expect(button().getAttribute("aria-expanded")).toBe("false");

            button().click();
            await settle();
            button().dispatchEvent(new Event("pointerdown", { bubbles: true }));
            row("talk").dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: button() }));
            await settle();
            expect(menu()).not.toBeNull();
            button().click();
            await settle();
            expect(menu()).toBeNull();
        });

        it("says where the bot's voice stands in its top line when something needs saying", async () => {
            const status = () => target.querySelector("[data-testid=voice-menu-status]")?.textContent?.trim();
            button().click();
            await settle();
            microphone.set(false);
            await settle();
            expect(status()).toBe("Your mic is off, so it can't hear you");
            voiceChoiceStore.choose("type_and_listen");
            await settle();
            expect(status()).toBe("In your bubble");
            t.say("paused");
            await settle();
            expect(status()).toBe("Voice paused");
        });

        describe("what is left of the spoken replies (#1669)", () => {
            const MIC = "Your microphone with people doesn't change.";
            const status = () => target.querySelector("[data-testid=voice-menu-status]")?.textContent?.trim();
            const foot = () => target.querySelector("[data-testid=voice-menu-foot]")?.textContent?.trim();
            const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

            it("says how many are left and when more come, above the line that is always true", async () => {
                t.say("on", 0, { repliesLeft: 18, repliesResetAt: inAnHour() });
                button().click();
                await settle();
                expect(foot()).toMatch(/^Up to 18 voice replies left, then you keep chatting in text\. More at .+\. /);
                expect(foot()?.endsWith(MIC)).toBe(true);
                expect(status()).toBe("In your bubble");
            });

            it("says 'reply' for one, and keeps to the count the bot gives next while the menu is open", async () => {
                t.say("on", 0, { repliesLeft: 1, repliesResetAt: inAnHour() });
                button().click();
                await settle();
                expect(foot()).toContain("Up to 1 voice reply left,");
                t.say("on", 0, { repliesLeft: 7, repliesResetAt: inAnHour() });
                await settle();
                expect(foot()).toContain("Up to 7 voice replies left,");
            });

            it("says no time for a count with no window running", async () => {
                t.say("on", 0, { repliesLeft: 25 });
                button().click();
                await settle();
                expect(foot()).toBe(`Up to 25 voice replies left, then you keep chatting in text. ${MIC}`);
            });

            it("says the replies are used up, and the voice paused until the time they come back", async () => {
                t.say("paused", 0, { repliesLeft: 0, repliesResetAt: inAnHour() });
                button().click();
                await settle();
                expect(status()).toMatch(/^Voice paused until .+/);
                expect(foot()).toBe(`Your voice replies are used up for now. Keep chatting in text. ${MIC}`);
            });

            it("says nothing about them when the bot has no count, or the window it counted has ended", async () => {
                t.say("on");
                button().click();
                await settle();
                expect(foot()).toBe(MIC);
                t.say("paused", 0, { repliesLeft: 0, repliesResetAt: new Date(Date.now() - 1000).toISOString() });
                await settle();
                expect(status()).toBe("Voice paused");
                expect(foot()).toBe(MIC);
            });
        });

        it("goes when the bot does", async () => {
            button().click();
            await settle();
            t.join();
            await settle();
            expect(menu()).toBeNull();
            expect(button().disabled).toBe(true);
        });
    });

    describe("listening in a group (round 8)", () => {
        const bar = () => target.querySelector<HTMLElement>("[data-testid=voice-bar]");
        const barText = () => bar()?.textContent?.replace(/\s+/g, " ").trim();
        const mark = () => target.querySelector<HTMLElement>("[data-testid=voice-mark]")?.dataset.mark;
        const sent = () =>
            (t.space.emitPrivateMessage as ReturnType<typeof vi.fn>).mock.calls.map(
                ([message]) => (message as { voiceModeChoice: { listen: string } }).voiceModeChoice.listen
            );
        const mishari = user("p2", { name: "Mishari" });

        beforeEach(async () => {
            cues.length = 0;
            t.join(nora, mishari);
            t.say("on", 30, { listening: "", listeningReason: "" });
            await settle();
        });

        it("says listening paused when a friend joins, with a soft sound, then folds into the button with a mic-off mark", async () => {
            vi.useFakeTimers();
            try {
                t.say("on", 30, { listening: "off", listeningReason: "others_joined" });
                await vi.advanceTimersByTimeAsync(0);
                expect(barText()).toBe("Nora's listening paused Tap for voice options");
                expect(cues).toEqual(["paused"]);
                expect(mark()).toBe("off");
                expect(label()).toBe("Nora, not listening to you. Opens voice options.");
                expect(target.querySelector("[data-testid=voice-announce]")?.textContent).toBe(
                    "Nora's listening paused. Tap for voice options"
                );
                // The same news again shows nothing new
                t.say("on", 30, { listening: "off", listeningReason: "others_joined" });
                await vi.advanceTimersByTimeAsync(7900);
                expect(bar()).not.toBeNull();
                await vi.advanceTimersByTimeAsync(200);
                expect(bar()).toBeNull();
                expect(mark()).toBe("off");
                expect(cues).toEqual(["paused"]);
            } finally {
                vi.useRealTimers();
            }
        });

        it("opens the options on a tap, with the warning and Keep talking first, which asks only that bot", async () => {
            t.say("on", 30, { listening: "off", listeningReason: "others_joined" });
            await settle();
            button().click();
            await settle();
            expect(target.querySelector("[data-testid=voice-menu-listening]")?.textContent?.trim()).toBe(
                "Listening paused · others joined"
            );
            const keep = target.querySelector<HTMLButtonElement>("[data-testid=voice-keep-talking]")!;
            expect(keep.textContent?.trim()).toBe("Keep talking to \u2068Nora\u2069");
            expect(document.activeElement).toBe(keep);
            expect(target.querySelector("[data-testid=voice-menu-now] .note")?.textContent).toBe(
                "While your mic is on, \u2068Nora\u2069 can hear you talking to friends until you stop or leave this room."
            );
            // Opening asked nothing
            expect(sent()).not.toContain("keep");
            keep.click();
            await settle();
            expect(sent().pop()).toBe("keep");
            expect(target.querySelector("[data-testid=voice-menu]")).toBeNull();
        });

        it("turns on, then says it listens with the ready sound and keeps the ring; Stop listening comes first in the options", async () => {
            t.say("on", 30, { listening: "off", listeningReason: "others_joined" });
            await settle();
            t.say("on", 30, { listening: "pending", listeningReason: "" });
            await settle();
            expect(barText()).toBe("Turning on… One moment");
            expect(button().classList.contains("ring-wait")).toBe(true);
            t.say("on", 30, { listening: "on", listeningReason: "" });
            await settle();
            expect(barText()).toBe("Listening to you Hears all you say");
            expect(cues).toEqual(["paused", "ready"]);
            expect(button().classList.contains("ring-on")).toBe(true);
            expect(mark()).toBe("on");
            expect(label()).toBe("Nora, listening to you. Opens voice options.");
            button().click();
            await settle();
            const actions = [...target.querySelectorAll<HTMLButtonElement>("[data-testid=voice-menu-now] button")];
            expect(actions.map((a) => a.textContent?.trim())).toEqual(["Stop listening"]);
            expect(document.activeElement).toBe(actions[0]);
            actions[0].click();
            await settle();
            expect(sent().pop()).toBe("stop");
        });

        it("offers Stop speaking right under Stop listening while a reply is heard, which stops only the reply", async () => {
            t.say("on", 30, { listening: "on", listeningReason: "" });
            t.speak("r1", true);
            await settle();
            button().click();
            await settle();
            const actions = [...target.querySelectorAll<HTMLButtonElement>("[data-testid=voice-menu-now] button")];
            expect(actions.map((a) => a.textContent?.trim())).toEqual(["Stop listening", "Stop speaking"]);
            expect(target.querySelector("[data-testid=voice-menu-listening]")?.textContent?.trim()).toBe(
                "Listening to you · speaking"
            );
            actions[1].click();
            await settle();
            const last = (t.space.emitPrivateMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
                voiceModeChoice: { listen: string; stopSpeaking: string };
            };
            expect(last.voiceModeChoice).toMatchObject({ listen: "", stopSpeaking: "r1" });
            expect(target.querySelector("[data-testid=voice-menu]")).toBeNull();
        });

        it("offers Cancel while turning on", async () => {
            t.say("on", 30, { listening: "pending", listeningReason: "" });
            await settle();
            button().click();
            await settle();
            target.querySelector<HTMLButtonElement>("[data-testid=voice-cancel-listening]")!.click();
            await settle();
            expect(sent().pop()).toBe("stop");
        });

        it("says it may still hear you while a stop is not confirmed, with the mic mark still on", async () => {
            t.say("on", 30, { listening: "on", listeningReason: "" });
            await settle();
            t.say("on", 30, { listening: "checking", listeningReason: "" });
            await settle();
            expect(barText()).toBe("Checking connection Nora may still hear you");
            expect(mark()).toBe("on");
            expect(target.querySelector("[data-testid=voice-mark]")?.classList.contains("amber")).toBe(true);
            t.say("on", 30, { listening: "off", listeningReason: "" });
            await settle();
            expect(bar()).toBeNull();
            expect(mark()).toBe("off");
        });

        it("tells someone who comes into a group that the bot isn't listening, once a visit", async () => {
            t.say("on", 30, { listening: "off", listeningReason: "" });
            await settle();
            expect(barText()).toBe("Nora isn't listening Tap for voice options");
            expect(cues).toEqual([]);
            t.say("on", 30, { listening: "", listeningReason: "" });
            await settle();
            t.say("on", 30, { listening: "off", listeningReason: "" });
            await settle();
            expect(bar()).toBeNull();
        });

        it("tells it once the bot's voice is on, when the first word came while it was connecting", async () => {
            t.say("connecting", 30, { listening: "off", listeningReason: "" });
            await settle();
            expect(bar()).toBeNull();
            t.say("on", 30, { listening: "off", listeningReason: "" });
            await settle();
            expect(barText()).toBe("Nora isn't listening Tap for voice options");
        });

        it("folds a bar that came after the options closed from a tap, though the focus went back to the button", async () => {
            vi.useFakeTimers();
            try {
                t.say("on", 30, { listening: "off", listeningReason: "others_joined" });
                await vi.advanceTimersByTimeAsync(10);
                button().click();
                await vi.advanceTimersByTimeAsync(10);
                target.querySelector<HTMLButtonElement>("[data-testid=voice-keep-talking]")!.click();
                await vi.advanceTimersByTimeAsync(10);
                expect(document.activeElement).toBe(button());
                t.say("on", 30, { listening: "pending", listeningReason: "" });
                t.say("on", 30, { listening: "on", listeningReason: "" });
                await vi.advanceTimersByTimeAsync(10);
                expect(barText()).toBe("Listening to you Hears all you say");
                await vi.advanceTimersByTimeAsync(4000);
                expect(bar()).toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });

        it("keeps today's options for a mode without the microphone: no bar, no listening top", async () => {
            voiceChoiceStore.choose("type_and_listen");
            t.say("on", 30, { listening: "", listeningReason: "" });
            await settle();
            expect(bar()).toBeNull();
            button().click();
            await settle();
            expect(target.querySelector("[data-testid=voice-menu-now]")).toBeNull();
            expect(target.querySelector("[data-testid=voice-menu-status]")).not.toBeNull();
        });
    });
});
