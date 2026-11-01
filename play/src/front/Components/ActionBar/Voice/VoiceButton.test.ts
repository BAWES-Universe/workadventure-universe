import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, readable, writable } from "svelte/store";
import { Subject } from "rxjs";

vi.mock("../../../Enum/EnvironmentVariable.ts", () => ({
    PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH: 0,
    PEER_VIDEO_RECOMMENDED_BANDWIDTH: 0,
    MAX_USERNAME_LENGTH: 10,
}));
vi.mock("../../../WebRtc/BlackListManager", () => ({ blackListManager: { isBlackListed: () => false } }));
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
                return text.replace(/\{(\w+)(?::\w+)?\}/g, (_all, key: string) => String(args?.[key]));
            },
        });
    return { default: readable(walk([])) };
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
    const space = {
        getName: () => "bubble-1",
        mySpaceUserId: "me",
        destroyed: false,
        usersStore: users,
        observePrivateEvent: () => statuses,
        emitPrivateMessage: vi.fn(),
    } as unknown as SpaceInterface;
    return {
        space,
        join: (...others: SpaceUserExtended[]) =>
            users.set(new Map([user("me"), ...others].map((u) => [u.spaceUserId, u]))),
        say: (state: string, followUpSeconds = 0) =>
            statuses.next({
                $case: "botVoiceStatus",
                sender: nora,
                botVoiceStatus: { botId: "1", botName: "Nora", state, followUpSeconds },
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

    it("asks for a tap when the sound is blocked, and the tap starts the sound instead of opening the menu", async () => {
        t.join(nora);
        t.say("on");
        const element = {
            srcObject: {},
            play: vi.fn().mockRejectedValue(Object.assign(new Error("blocked"), { name: "NotAllowedError" })),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };
        const unwatch = watchBotAudio("b1", element as unknown as HTMLMediaElement);
        await settle();
        expect(label()).toBe("Voice with Nora: tap to hear");
        element.play.mockResolvedValue(undefined);
        button().click();
        expect(element.play).toHaveBeenCalledTimes(2);
        expect(resumeAll).toHaveBeenCalled();
        await settle();
        expect(target.querySelector("[data-testid=voice-menu]")).toBeNull();
        expect(label()).toBe("Voice with Nora: talk and listen");
        unwatch();
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

        it("goes when the bot does", async () => {
            button().click();
            await settle();
            t.join();
            await settle();
            expect(menu()).toBeNull();
            expect(button().disabled).toBe(true);
        });
    });
});
