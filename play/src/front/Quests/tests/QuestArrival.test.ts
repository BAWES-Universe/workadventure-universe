import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, readable } from "svelte/store";

const env = vi.hoisted(() => ({ FEATURE_FLAG_QUESTS_PROOF_SLICE: true }));
const scene = vi.hoisted(() => ({ current: { CurrentPlayer: { x: 0, y: 0 } } as unknown }));
vi.mock("../../Enum/EnvironmentVariable", () => env);
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: { tryGetCurrentGameScene: () => scene.current } }));
vi.mock("../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});
vi.mock("../QuestUiStores", async () => {
    const { writable } = await import("svelte/store");
    return { questSurfaceSuppressed: writable(false) };
});

import { INVITATION_DELAY_MS, INVITATION_FADE_AFTER_MOVING_MS, startQuestArrival } from "../QuestArrival";
import { questArrivalStore, questStateStore, resetQuests, setQuestWorld } from "../QuestStore";
import * as uiStores from "../QuestUiStores";
import { EMPTY_QUEST_WORLD } from "../QuestWorld";

const suppressed = uiStores.questSurfaceSuppressed as unknown as { set: (value: boolean) => void };
let stop: (() => void) | undefined;

beforeEach(() => {
    vi.useFakeTimers();
    resetQuests();
    suppressed.set(false);
    scene.current = { CurrentPlayer: { x: 0, y: 0 } };
    setQuestWorld({
        ...EMPTY_QUEST_WORLD,
        ready: true,
        exploreTarget: {
            area: { id: "a", name: "Courtyard", x: 0, y: 0, width: 64, height: 64 },
            alreadyInside: false,
        },
    });
    questArrivalStore.set("waiting");
    stop = startQuestArrival();
});

afterEach(() => {
    stop?.();
    vi.useRealTimers();
});

const surface = () => get(questStateStore).surface;

describe("arrival invitation", () => {
    it("appears 1.5 s after the first moment nothing covers the game, once per arrival", () => {
        suppressed.set(true);
        questArrivalStore.set("ready");
        vi.advanceTimersByTime(10_000);
        expect(surface()).toBe("none");

        suppressed.set(false);
        vi.advanceTimersByTime(INVITATION_DELAY_MS - 1);
        expect(surface()).toBe("none");
        vi.advanceTimersByTime(1);
        expect(surface()).toBe("invitation");
    });

    it("waits for the map: nothing while arriving, nothing for someone who came to meet a person", () => {
        vi.advanceTimersByTime(10_000);
        expect(surface()).toBe("none");
        questArrivalStore.set("skipped");
        vi.advanceTimersByTime(10_000);
        expect(surface()).toBe("none");
    });

    it("does nothing while no map is current", () => {
        scene.current = undefined;
        questArrivalStore.set("ready");
        vi.advanceTimersByTime(INVITATION_DELAY_MS);
        expect(surface()).toBe("none");
    });

    it("fades after 45 s of walking without an answer, which is not a decline", () => {
        questArrivalStore.set("ready");
        vi.advanceTimersByTime(INVITATION_DELAY_MS);
        expect(surface()).toBe("invitation");

        // Standing still does not count.
        vi.advanceTimersByTime(60_000);
        expect(surface()).toBe("invitation");

        const player = (scene.current as { CurrentPlayer: { x: number } }).CurrentPlayer;
        for (let second = 0; second <= INVITATION_FADE_AFTER_MOVING_MS / 1000 + 1; second++) {
            player.x += 5;
            vi.advanceTimersByTime(1_000);
        }
        expect(surface()).toBe("none");
        expect(get(questStateStore).declined).toBe(false);
        expect(get(questStateStore).news).toBe(true);
    });

    it("fades when the player leaves the map with it open", () => {
        questArrivalStore.set("ready");
        vi.advanceTimersByTime(INVITATION_DELAY_MS);
        questArrivalStore.set("waiting");
        expect(surface()).toBe("none");
        expect(get(questStateStore).invitationSeen).toBe(1);
    });
});
