import { get } from "svelte/store";
import type { AreaData } from "@workadventure/map-editor";
import { isBotUser } from "../Chat/UserProvider/ChatUserMapper";
import type { ProximityChatRoom } from "../Chat/Connection/Proximity/ProximityChatRoom";
import { localUserStore } from "../Connection/LocalUserStore";
import { CreateEntityFrontCommand } from "../Phaser/Game/MapEditor/Commands/Entity/CreateEntityFrontCommand";
import { mapEditorCommandExecuted$ } from "../Phaser/Game/MapEditor/MapEditorModeManager";
import { saySent$ } from "../Phaser/Game/Say/sendSay";
import type { GameScene } from "../Phaser/Game/GameScene";
import { gameManager } from "../Phaser/Game/GameManager";
import { mapEditorMenuVisibleStore } from "../Stores/MenuStore";
import { classifyMeetMessage, MeetExchange } from "./MeetExchange";
import type { MeetMessage } from "./MeetExchange";
import { arrivalRule, consumeQuestHashSnapshot, questHashSnapshot, questTargetsForArrival } from "./QuestHash";
import type { QuestArea, QuestPresent, QuestWorld } from "./QuestWorld";
import { namedOpenAreas, pickExploreTarget, resolveQuestHost } from "./QuestWorld";
import {
    completeQuest,
    pauseQuest,
    questArrivalStore,
    questMeetProgressStore,
    questSim,
    questStateStore,
    resumeQuest,
    setMeetAlreadyExchanged,
    setQuestWorld,
    setQuestWorldRefresher,
} from "./QuestStore";

/** GameMapAreas tests area membership at the feet, this far below the player's position. */
const AREA_FEET_OFFSET_Y = 16;
/** A bot host may not be on the map yet when the scene is ready (bots are spawned on demand). */
export const HOST_WAIT_MS = 5_000;
/** After a `#moveTo` arrival, how long to wait for that first walk to end. */
export const MOVE_TO_WAIT_MS = 8_000;
/**
 * Stand-in for a bot's reply: a real bot may not answer, so with `questSim=bot` the host bot being in the
 * same bubble counts as its side of the exchange this long after the player's hello. A real reply counts as well,
 * and earlier. Nothing is written to the chat.
 */
export const SIM_BOT_REPLY_MS = 2_500;

/** How often to look again for the proximity chat, which the scene creates once its connection is up. */
export const CHAT_ROOM_RETRY_MS = 500;

type MovementListener = Parameters<GameScene["onPlayerMovementEnded"]>[0];
type EnterAreaListener = Parameters<ReturnType<GameScene["getGameMapFrontWrapper"]>["onEnterArea"]>[0];
const movementHubs = new WeakMap<object, Set<MovementListener>>();
const enterAreaHubs = new WeakMap<object, Set<EnterAreaListener>>();

/**
 * The scene and the map only let callbacks be added, never removed. One forwarding callback per scene (or map) feeds a
 * set that quests can leave again, so arming the same map twice (the dock re-mounting) never piles callbacks up.
 */
function onMovementEnded(scene: GameScene, listener: MovementListener): () => void {
    let hub = movementHubs.get(scene);
    if (!hub) {
        const listeners = new Set<MovementListener>();
        hub = listeners;
        movementHubs.set(scene, listeners);
        scene.onPlayerMovementEnded((event) => {
            for (const forward of Array.from(listeners)) forward(event);
        });
    }
    hub.add(listener);
    const listeners = hub;
    return () => listeners.delete(listener);
}

function onEnterArea(scene: GameScene, listener: EnterAreaListener): () => void {
    const map = scene.getGameMapFrontWrapper();
    let hub = enterAreaHubs.get(map);
    if (!hub) {
        const listeners = new Set<EnterAreaListener>();
        hub = listeners;
        enterAreaHubs.set(map, listeners);
        map.onEnterArea((...args: Parameters<EnterAreaListener>) => {
            for (const forward of Array.from(listeners)) forward(...args);
        });
    }
    hub.add(listener);
    const listeners = hub;
    return () => listeners.delete(listener);
}

function toQuestArea(area: AreaData): QuestArea {
    return { id: area.id, name: area.name, x: area.x, y: area.y, width: area.width, height: area.height };
}

/**
 * Watches one map for the three objectives and for who is here. Everything it registers is undone by the returned
 * function.
 */
export function armQuestScene(scene: GameScene): () => void {
    let active = true;
    const cleanups: Array<() => void> = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const localUuid = localUserStore.getLocalUser()?.uuid;
    let targets = questTargetsForArrival();
    const exchange = new MeetExchange();

    // Timers only fire while this map is still the current one.
    const later = (ms: number, run: () => void) => {
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (!active || gameManager.tryGetCurrentGameScene() !== scene) return;
            run();
        }, ms);
        timers.add(timer);
    };

    // Quest work reached from the host's own callbacks (area changes, chat and say streams, map editor commands)
    // runs after them, never inside: a throw here can't cut short the area handlers or a store's notification loop.
    const deferred = (run: () => void) => {
        queueMicrotask(() => {
            if (!active) return;
            try {
                run();
            } catch (error) {
                console.warn("Quests: could not record progress", error);
            }
        });
    };

    const readPresent = (): QuestPresent[] => {
        const present: QuestPresent[] = [];
        for (const player of scene.MapPlayersByKey.values()) {
            if (localUuid && player.userUuid === localUuid) continue;
            present.push({
                userId: player.userId,
                uuid: player.userUuid,
                name: player.playerName,
                isBot: isBotUser({ uuid: player.userUuid }),
            });
        }
        return present;
    };

    const readAreas = (): QuestArea[] => {
        const wrapper = scene.getGameMapFrontWrapper();
        const closed = new Set((wrapper.areasManager?.getCollidingAreas() ?? []).map((area) => area.id));
        return namedOpenAreas([...(wrapper.getAreas()?.values() ?? [])].map(toQuestArea), closed);
    };

    const playerFeet = (): { x: number; y: number } | undefined => {
        const player = scene.CurrentPlayer;
        return player ? { x: player.x, y: player.y + AREA_FEET_OFFSET_Y } : undefined;
    };

    const roomName = (): string | undefined => {
        try {
            return scene.room.roomName;
        } catch {
            return undefined;
        }
    };

    const buildWorld = (): QuestWorld => {
        const present = readPresent();
        const areas = readAreas();
        const state = get(questStateStore);
        // Once Explore is accepted its area is fixed; before that, the nearest one is offered.
        const fixed = state.exploreArea
            ? areas.find((area) => area.id === state.exploreArea?.id) ??
              areas.find((area) => area.name === state.exploreArea?.name)
            : undefined;
        // Once Explore is accepted its area is fixed: on a map without it there is no target, never a nearby stand-in.
        const exploreTarget = state.exploreArea
            ? fixed
                ? { area: fixed, alreadyInside: false }
                : undefined
            : pickExploreTarget(areas, playerFeet(), targets.questArea);
        return {
            ready: true,
            roomName: roomName(),
            host: resolveQuestHost(questSim, present, areas, targets.questHost),
            present,
            exploreTarget,
            canBuild: get(mapEditorMenuVisibleStore),
        };
    };

    let world: QuestWorld | undefined;
    const refreshWorld = () => {
        if (!active) return;
        try {
            world = buildWorld();
        } catch (error) {
            console.warn("Quests: could not read the map", error);
            return;
        }
        setQuestWorld(world);
        // Meet pauses while nobody is here and resumes silently when someone comes back.
        const meet = get(questStateStore).quests.meet;
        if (meet.accepted && !meet.done) {
            if (world.present.length === 0) pauseQuest("meet");
            else if (meet.paused) resumeQuest("meet");
        }
    };

    setQuestWorldRefresher(refreshWorld);
    cleanups.push(() => setQuestWorldRefresher(undefined));

    // The area manager is set up right after the map reports loaded: read the world on the next tick.
    later(0, () => {
        refreshWorld();
        creditExploreIfInside();
        cleanups.push(scene.MapPlayersByKey.subscribe(() => refreshWorld()));
        cleanups.push(mapEditorMenuVisibleStore.subscribe(() => refreshWorld()));
        armArrival();
    });

    // Explore: entering the fixed area. -------------------------------------------------------------------------
    // Already standing in it when the map opens (a restored quest): credit it, nobody has to step out and back in.
    function creditExploreIfInside() {
        const state = get(questStateStore);
        const target = world?.exploreTarget;
        const feet = playerFeet();
        if (!state.quests.explore.accepted || state.quests.explore.done || !state.exploreArea || !target || !feet) {
            return;
        }
        const { x, y, width, height } = target.area;
        if (feet.x >= x && feet.x <= x + width && feet.y >= y && feet.y <= y + height) {
            completeQuest("explore", "already-valid");
        }
    }
    const stopEnterArea = onEnterArea(scene, (entered) => {
        if (!active) return;
        const names = entered.map((area) => ({ id: area.id, name: area.name }));
        deferred(() => {
            const state = get(questStateStore);
            const explore = state.quests.explore;
            if (!explore.accepted || explore.done || !state.exploreArea) return;
            const target = state.exploreArea;
            if (names.some((area) => area.id === target.id || area.name === target.name)) completeQuest("explore");
        });
    });
    cleanups.push(stopEnterArea);

    // Meet: a message each way within one bubble session. -----------------------------------------------------------
    const setMeetProgress = () => questMeetProgressStore.set(exchange.progress);
    const onExchangeSide = (side: "mine" | "theirs", sessionId: string | undefined) => {
        if (exchange.record(side, sessionId)) completeQuest("meet");
        setMeetProgress();
    };
    setMeetAlreadyExchanged(() => active && exchange.progress === "exchanged");
    cleanups.push(() => setMeetAlreadyExchanged(undefined));

    // The scene creates its proximity chat once its connection is up, which can be after the map counts as loaded.
    // Until then, keep looking; Meet starts listening as soon as it exists.
    const chatRoom = (): ProximityChatRoom | undefined => {
        try {
            return scene.proximityChatRoom;
        } catch {
            return undefined;
        }
    };
    const armMeet = (chat: ProximityChatRoom) => {
        const seen = new Set<string>();
        for (const message of Array.from(get(chat.messages))) seen.add(message.id);
        let participantNames: string[] = [];
        // Participants carry names, not uuids: the name is how the stand-in finds the host bot in the bubble.
        const hostInBubble = () => {
            const host = world?.host;
            return host?.kind === "bot" && participantNames.includes(host.name);
        };

        const scheduleSimReply = (sessionId: string | undefined) => {
            if (questSim !== "bot" || !hostInBubble()) return;
            later(SIM_BOT_REPLY_MS, () => {
                if (!hostInBubble() || chat.currentSessionId !== sessionId) return;
                onExchangeSide("theirs", sessionId);
            });
        };

        cleanups.push(
            chat.participants.subscribe((participants) => {
                exchange.enterSession(chat.currentSessionId);
                participantNames = participants.map((participant) => participant.name);
                setMeetProgress();
            })
        );
        cleanups.push(
            chat.messages.subscribe((messages) => {
                for (const message of Array.from(messages)) {
                    if (seen.has(message.id)) continue;
                    seen.add(message.id);
                    const side = classifyMeetMessage(message as unknown as MeetMessage, localUuid);
                    if (side === "ignore") continue;
                    const sessionId = chat.currentSessionId;
                    deferred(() => {
                        // A session that ended before this ran no longer counts (see MeetExchange).
                        if (chat.currentSessionId !== sessionId) return;
                        exchange.enterSession(sessionId);
                        onExchangeSide(side, sessionId);
                        if (side === "mine") scheduleSimReply(sessionId);
                    });
                }
            })
        );
        // A say bubble sent while in a bubble is the player's side too (one thumb on a phone).
        const saySubscription = saySent$.subscribe((type) => {
            if (type !== "say") return;
            const sessionId = chat.currentSessionId;
            if (sessionId === undefined) return;
            deferred(() => {
                if (chat.currentSessionId !== sessionId) return;
                exchange.enterSession(sessionId);
                onExchangeSide("mine", sessionId);
                scheduleSimReply(sessionId);
            });
        });
        cleanups.push(() => saySubscription.unsubscribe());
    };
    const lookForChat = () => {
        const chat = chatRoom();
        if (chat) armMeet(chat);
        else later(CHAT_ROOM_RETRY_MS, lookForChat);
    };
    lookForChat();
    cleanups.push(() => questMeetProgressStore.set("idle"));

    // Build: the first object this player places. -------------------------------------------------------------------
    const buildSubscription = mapEditorCommandExecuted$.subscribe((command) => {
        if (command instanceof CreateEntityFrontCommand) deferred(() => completeQuest("build"));
    });
    cleanups.push(() => buildSubscription.unsubscribe());

    // Orbit's Visit link on the room already open only teleports (no new scene): pick up its area and host here.
    const onHashChange = () => {
        const live = questTargetsForArrival();
        if (live.questArea === undefined && live.questHost === undefined) return;
        targets = live;
        refreshWorld();
    };
    window.addEventListener("hashchange", onHashChange);
    cleanups.push(() => window.removeEventListener("hashchange", onHashChange));

    // Arrival: when the invitation may start its countdown. ------------------------------------------------------
    function armArrival() {
        const rule = arrivalRule(questHashSnapshot());
        // The hash belongs to the first map this page opened; later maps are judged on an empty one.
        consumeQuestHashSnapshot();
        if (rule === "skip") {
            questArrivalStore.set("skipped");
            return;
        }
        let moved = rule !== "after-move";
        let hostChecked = false;
        const settle = () => {
            if (moved && hostChecked) questArrivalStore.set("ready");
        };
        const hostHere = () => world?.host.kind !== "none" || questSim !== "bot";
        if (hostHere()) hostChecked = true;
        else {
            const stopWaitingForHost = scene.MapPlayersByKey.subscribe(() => {
                if (hostChecked || !hostHere()) return;
                hostChecked = true;
                settle();
            });
            cleanups.push(stopWaitingForHost);
            later(HOST_WAIT_MS, () => {
                hostChecked = true;
                settle();
            });
        }
        if (!moved) {
            cleanups.push(
                onMovementEnded(scene, () => {
                    if (!active || moved) return;
                    moved = true;
                    settle();
                })
            );
            later(MOVE_TO_WAIT_MS, () => {
                moved = true;
                settle();
            });
        }
        settle();
    }

    return () => {
        active = false;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        for (const cleanup of cleanups.splice(0)) {
            try {
                cleanup();
            } catch (error) {
                console.warn("Quests: cleanup failed", error);
            }
        }
        exchange.reset();
        questArrivalStore.set("waiting");
    };
}
