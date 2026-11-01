import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, readable, writable } from "svelte/store";
import { Subject } from "rxjs";

vi.mock("../../../Enum/EnvironmentVariable.ts", () => ({
    PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH: 0,
    PEER_VIDEO_RECOMMENDED_BANDWIDTH: 0,
    MAX_USERNAME_LENGTH: 10,
}));
const blocked = new Set<string>();
vi.mock("../../../WebRtc/BlackListManager", () => ({
    blackListManager: { isBlackListed: (uuid: string) => blocked.has(uuid) },
}));
const resumeAll = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../WebRtc/AudioContextManager", () => ({ audioContextManager: { resumeAll: () => resumeAll() } }));

import { localUserStore } from "../../../Connection/LocalUserStore";
import type { SpaceInterface, SpaceUserExtended } from "../../../Space/SpaceInterface";
import {
    computeVoiceView,
    currentVoiceSpaceStore,
    resumeBotSound,
    silencedVoiceBotsStore,
    soundBlockedStore,
    trackVoiceSpace,
    voiceBotSpaceUserIdsStore,
    voiceChoiceStore,
    watchBotAudio,
} from "../VoiceBots";
import type { BotVoiceStatus } from "../VoiceMode";

const user = (spaceUserId: string, extra: Partial<SpaceUserExtended> = {}): SpaceUserExtended =>
    ({
        spaceUserId,
        uuid: `uuid-${spaceUserId}`,
        tags: [],
        name: spaceUserId,
        pictureStore: readable(`${spaceUserId}.png`),
        ...extra,
    } as unknown as SpaceUserExtended);
const bot = (spaceUserId: string, botId: string, tags = ["bot", "voice-bot"]) =>
    user(spaceUserId, { uuid: `bot-${botId}`, tags, name: `Bot ${botId}` });
const status = (
    botId: string,
    state: BotVoiceStatus["state"],
    extra: Partial<BotVoiceStatus> = {}
): BotVoiceStatus => ({
    botId,
    botName: `Nora ${botId}`,
    state,
    followUpSeconds: 0,
    ...extra,
});

describe("who is here with a voice bot", () => {
    it("shows the voice bot with the state it said, and us counted among the people", () => {
        const view = computeVoiceView(
            [user("me"), bot("b1", "1")],
            "me",
            new Map([["b1", status("1", "on", { followUpSeconds: 30 })]]),
            false
        );
        expect(view.bot).toMatchObject({
            spaceUserId: "b1",
            botId: "1",
            name: "Nora 1",
            state: "on",
            followUpSeconds: 30,
        });
        expect(view).toMatchObject({ people: 2, othersPresent: false, meeting: false, botSpaceUserIds: ["b1"] });
    });

    it("has no button for a text-only bot, whatever else is here", () => {
        const view = computeVoiceView([user("me"), user("sara"), bot("b1", "1", ["bot"])], "me", new Map(), false);
        expect(view.bot).toBeUndefined();
        expect(view.othersPresent).toBe(true);
    });

    it("takes a bot that sent a status as a voice bot even without the tag, and a tagged one as connecting until it says", () => {
        expect(
            computeVoiceView(
                [user("me"), bot("b1", "1", ["bot"])],
                "me",
                new Map([["b1", status("1", "paused")]]),
                false
            ).bot?.state
        ).toBe("paused");
        expect(computeVoiceView([user("me"), bot("b1", "1")], "me", new Map(), false).bot?.state).toBe("connecting");
    });

    it("counts people only when another real person is here, not another bot", () => {
        const view = computeVoiceView([user("me"), bot("b1", "1"), bot("b2", "2", ["bot"])], "me", new Map(), false);
        expect(view.othersPresent).toBe(false);
        expect(view.people).toBe(3);
        expect(computeVoiceView([user("me"), bot("b1", "1"), user("sara")], "me", new Map(), true)).toMatchObject({
            people: 3,
            othersPresent: true,
            meeting: true,
        });
    });

    it("is for the first voice bot only when there are two", () => {
        const view = computeVoiceView([user("me"), bot("b1", "1"), bot("b2", "2")], "me", new Map(), false);
        expect(view.bot?.spaceUserId).toBe("b1");
        expect(view.botSpaceUserIds).toEqual(["b1", "b2"]);
    });
});

/** A space as the game gives it: its people, the private events of bots, and what we send. */
function fakeSpace(name = "bubble-1") {
    const users = writable(new Map<string, SpaceUserExtended>([["me", user("me")]]));
    const statusEvents = new Subject<unknown>();
    const emitted: [unknown, string][] = [];
    const space = {
        getName: () => name,
        mySpaceUserId: "me",
        destroyed: false,
        usersStore: users,
        observePrivateEvent: (key: string) => {
            if (key !== "botVoiceStatus") throw new Error(`unexpected ${key}`);
            return statusEvents;
        },
        emitPrivateMessage: (message: unknown, to: string) => emitted.push([message, to]),
    } as unknown as SpaceInterface;
    const set = (...list: SpaceUserExtended[]) => users.set(new Map(list.map((u) => [u.spaceUserId, u])));
    const say = (sender: SpaceUserExtended, botVoiceStatus: object) =>
        statusEvents.next({ $case: "botVoiceStatus", spaceName: name, sender, botVoiceStatus });
    return { space, set, say, emitted };
}

const choiceSent = (emitted: [unknown, string][]) =>
    emitted.map(([message, to]) => [(message as { voiceModeChoice: { mode: string } }).voiceModeChoice.mode, to]);

describe("following a bubble for voice bots", () => {
    let stop: (() => void) | undefined;

    beforeEach(() => {
        localStorage.clear();
        voiceChoiceStore.choose("talk");
        blocked.clear();
    });
    afterEach(() => {
        stop?.();
        stop = undefined;
    });

    it("shows nothing until a voice bot is here, then follows its state through connecting, on and paused", () => {
        const t = fakeSpace();
        stop = trackVoiceSpace(t.space);
        expect(get(currentVoiceSpaceStore)).toBeUndefined();
        const nora = bot("b1", "1");
        t.set(user("me"), nora);
        expect(get(currentVoiceSpaceStore)?.bot?.state).toBe("connecting");
        t.say(nora, { botId: "1", botName: "Nora", state: "on", followUpSeconds: 0 });
        expect(get(currentVoiceSpaceStore)?.bot).toMatchObject({ name: "Nora", state: "on" });
        t.say(nora, { botId: "1", botName: "Nora", state: "paused", followUpSeconds: 0 });
        expect(get(currentVoiceSpaceStore)?.bot?.state).toBe("paused");
        t.say(nora, { botId: "1", botName: "Nora", state: "connecting", followUpSeconds: 0 });
        expect(get(currentVoiceSpaceStore)?.bot?.state).toBe("connecting");
        t.set(user("me"));
        expect(get(currentVoiceSpaceStore)).toBeUndefined();
    });

    it("forgets the space when we leave it", () => {
        const t = fakeSpace();
        stop = trackVoiceSpace(t.space);
        t.set(user("me"), bot("b1", "1"));
        expect(get(currentVoiceSpaceStore)).toBeDefined();
        stop();
        stop = undefined;
        expect(get(currentVoiceSpaceStore)).toBeUndefined();
        expect(get(voiceBotSpaceUserIdsStore).size).toBe(0);
    });

    it("says it is a meeting for a meeting room's space", () => {
        const t = fakeSpace("area__sales");
        stop = trackVoiceSpace(t.space);
        t.set(user("me"), bot("b1", "1"));
        expect(get(currentVoiceSpaceStore)?.meeting).toBe(true);
    });

    it("trusts a status only from a bot, about itself", () => {
        const t = fakeSpace();
        stop = trackVoiceSpace(t.space);
        const nora = bot("b1", "1");
        const sara = user("sara");
        t.set(user("me"), nora, sara);
        t.say(sara, { botId: "1", botName: "Nora", state: "paused", followUpSeconds: 0 });
        t.say(nora, { botId: "2", botName: "Nora", state: "paused", followUpSeconds: 0 });
        t.say(nora, { botId: "1", botName: "Nora", state: "listening", followUpSeconds: 0 });
        expect(get(currentVoiceSpaceStore)?.bot?.state).toBe("connecting");
        expect(t.emitted).toEqual([]);
        blocked.add("bot-1");
        t.say(nora, { botId: "1", botName: "Nora", state: "paused", followUpSeconds: 0 });
        expect(get(currentVoiceSpaceStore)?.bot?.state).toBe("connecting");
    });

    it("sends our saved choice to the bot when it first speaks to us, and again when it starts connecting", () => {
        voiceChoiceStore.choose("type_and_listen");
        const t = fakeSpace();
        stop = trackVoiceSpace(t.space);
        const nora = bot("b1", "1");
        t.set(user("me"), nora);
        expect(t.emitted).toEqual([]);
        t.say(nora, { botId: "1", botName: "Nora", state: "connecting", followUpSeconds: 0 });
        t.say(nora, { botId: "1", botName: "Nora", state: "on", followUpSeconds: 0 });
        t.say(nora, { botId: "1", botName: "Nora", state: "on", followUpSeconds: 0 });
        expect(choiceSent(t.emitted)).toEqual([["type_and_listen", "b1"]]);
        t.say(nora, { botId: "1", botName: "Nora", state: "paused", followUpSeconds: 0 });
        t.say(nora, { botId: "1", botName: "Nora", state: "connecting", followUpSeconds: 0 });
        expect(choiceSent(t.emitted)).toHaveLength(2);
    });

    it("sends each change of choice to the bots it has heard from, in the bot's own words for it", () => {
        const t = fakeSpace();
        stop = trackVoiceSpace(t.space);
        const nora = bot("b1", "1");
        t.set(user("me"), nora, bot("b2", "2"));
        t.say(nora, { botId: "1", botName: "Nora", state: "on", followUpSeconds: 0 });
        t.emitted.length = 0;
        for (const choice of ["speak_and_read", "text_only", "talk"] as const) voiceChoiceStore.choose(choice);
        expect(choiceSent(t.emitted)).toEqual([
            ["speak_and_read", "b1"],
            ["off", "b1"],
            ["talk", "b1"],
        ]);
    });

    it("sends nothing to a bot that left, and nothing once we left", () => {
        const t = fakeSpace();
        stop = trackVoiceSpace(t.space);
        const nora = bot("b1", "1");
        t.set(user("me"), nora);
        t.say(nora, { botId: "1", botName: "Nora", state: "on", followUpSeconds: 0 });
        t.set(user("me"));
        t.emitted.length = 0;
        voiceChoiceStore.choose("text_only");
        expect(t.emitted).toEqual([]);
    });

    it("silences the sound of voice bots when we chose not to hear them, and not otherwise", () => {
        const t = fakeSpace();
        stop = trackVoiceSpace(t.space);
        t.set(user("me"), bot("b1", "1"));
        expect([...get(silencedVoiceBotsStore)]).toEqual([]);
        voiceChoiceStore.choose("text_only");
        expect([...get(silencedVoiceBotsStore)]).toEqual(["b1"]);
        voiceChoiceStore.choose("speak_and_read");
        expect([...get(silencedVoiceBotsStore)]).toEqual(["b1"]);
        voiceChoiceStore.choose("type_and_listen");
        expect([...get(silencedVoiceBotsStore)]).toEqual([]);
    });
});

describe("the choice you made", () => {
    beforeEach(() => localStorage.clear());

    it("is talk and listen until you choose", () => {
        expect(localUserStore.getVoiceChoice()).toBe("talk");
    });

    it("is kept for you, and read back", () => {
        voiceChoiceStore.choose("speak_and_read");
        expect(get(voiceChoiceStore)).toBe("speak_and_read");
        expect(localUserStore.getVoiceChoice()).toBe("speak_and_read");
    });

    it("reads anything else that was saved as the default", () => {
        localStorage.setItem("voiceChoice", "loud");
        expect(localUserStore.getVoiceChoice()).toBe("talk");
    });
});

describe("sound the browser will not start", () => {
    /** An element as a browser gives it: play() is refused until the person has tapped. */
    function fakeAudio(options: { refuse: boolean }) {
        const listeners = new Map<string, () => void>();
        const element = {
            srcObject: {} as MediaStream,
            play: vi.fn(() =>
                options.refuse
                    ? Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" }))
                    : Promise.resolve()
            ),
            addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
            removeEventListener: (name: string) => listeners.delete(name),
        };
        return {
            element: element as unknown as HTMLMediaElement,
            play: element.play,
            options,
            fire: (name: string) => listeners.get(name)?.(),
        };
    }
    const settle = () =>
        new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });

    it("is told to the button, and gone once the sound plays", async () => {
        const audio = fakeAudio({ refuse: true });
        const stop = watchBotAudio("b1", audio.element);
        await settle();
        expect(get(soundBlockedStore).has("b1")).toBe(true);
        audio.options.refuse = false;
        audio.fire("playing");
        expect(get(soundBlockedStore).has("b1")).toBe(false);
        stop();
    });

    it("is not told for a refusal that is not about a tap, nor when it plays at once", async () => {
        const audio = fakeAudio({ refuse: false });
        const stop = watchBotAudio("b1", audio.element);
        await settle();
        expect(get(soundBlockedStore).has("b1")).toBe(false);
        audio.play.mockRejectedValueOnce(new Error("something else"));
        audio.fire("loadedmetadata");
        await settle();
        expect(get(soundBlockedStore).has("b1")).toBe(false);
        stop();
    });

    it("starts the sound and the audio context again inside the tap, and clears the button", async () => {
        const audio = fakeAudio({ refuse: true });
        const stop = watchBotAudio("b1", audio.element);
        await settle();
        expect(get(soundBlockedStore).has("b1")).toBe(true);
        audio.options.refuse = false;
        audio.play.mockClear();
        resumeAll.mockClear();
        resumeBotSound("b1");
        // Both were started in the same turn as the tap, before anything awaited
        expect(audio.play).toHaveBeenCalledTimes(1);
        expect(resumeAll).toHaveBeenCalledTimes(1);
        await settle();
        expect(get(soundBlockedStore).has("b1")).toBe(false);
        stop();
    });

    it("forgets a bot's sound once its element is gone", async () => {
        const audio = fakeAudio({ refuse: true });
        const stop = watchBotAudio("b1", audio.element);
        await settle();
        stop();
        expect(get(soundBlockedStore).has("b1")).toBe(false);
    });
});
