import { derived, get, writable } from "svelte/store";
import type { BroadcastMeta, CharacterTextureMessage } from "@workadventure/messages";
import { gameSceneStore } from "./GameSceneStore";
import { exploreStore } from "./ExploreStore";
import { playersStore } from "./PlayersStore";

/** Whether the Broadcast card (what to share, who hears it, the room's broadcast settings) is open. */
export const broadcastPanelOpenStore = writable(false);
/** The card opens on its settings page instead of "What do you want to share?". */
export const broadcastPanelSettingsStore = writable(false);

export type BroadcastKind = "message" | "voice" | "live";
export type BroadcastReach = "ROOM" | "WORLD" | "UNIVERSE";

export interface BroadcastReachInfo {
    /** This room's name, and how many people are in it right now (you included). */
    roomName: string;
    peopleHere: number;
    /** This world's name and how many rooms it has; undefined when the room belongs to no world. */
    worldName: string | undefined;
    worldRooms: number;
    /** How many people are in this world right now; undefined when the server sent no counts. */
    worldPeople: number | undefined;
    /** The universe's name and how many worlds it has; undefined until Orbit has answered, or when there is none. */
    universeName: string | undefined;
    universeWorlds: number;
    /** How many people are in this universe right now; undefined when the server sent no counts. */
    universePeople: number | undefined;
}

function roomNameFromUrl(url: string | undefined): string {
    if (!url) return "";
    try {
        const path = new URL(url).pathname.split("/").filter((part) => part !== "");
        return path[path.length - 1] ?? "";
    } catch {
        return "";
    }
}

/** What each reach covers, in words: the names and counts the Broadcast card shows under "This room", "This world"
 * and "Everywhere in this universe". */
export const broadcastReachInfoStore = derived(
    [gameSceneStore, exploreStore, playersStore],
    ([$gameScene, $explore, $players]): BroadcastReachInfo => {
        const room = $gameScene?.room;
        const universe = $explore.universe;
        const currentWorld = universe?.worlds.find((world) => world.isCurrent);
        // The room's group is "universe/world" for Orbit's rooms.
        const groupWorld = room?.group?.split("/")[1];
        const currentRoom = currentWorld?.rooms.find((candidate) => candidate.isCurrent);
        const peopleHere = $players.size + 1;
        // The other rooms as the server counted them, this one as you see it now: a world never has fewer
        // people than the room you're in.
        const peopleIn = (rooms: { isCurrent: boolean; peopleNow?: number }[]): number | undefined =>
            rooms.some((candidate) => candidate.peopleNow !== undefined)
                ? rooms.reduce((sum, candidate) => sum + (candidate.isCurrent ? 0 : candidate.peopleNow ?? 0), 0) +
                  peopleHere
                : undefined;
        return {
            roomName: currentRoom?.name || room?.roomName || roomNameFromUrl(room?.href),
            peopleHere,
            worldName: currentWorld?.name ?? (groupWorld ? groupWorld : undefined),
            worldRooms: currentWorld?.rooms.length ?? 0,
            worldPeople: currentWorld ? peopleIn(currentWorld.rooms) : undefined,
            universeName: universe?.universeName || undefined,
            universeWorlds: universe?.worlds.length ?? 0,
            universePeople: universe ? peopleIn(universe.worlds.flatMap((world) => world.rooms)) : undefined,
        };
    }
);

/** The name of what a reach covers, for "Send to This world" and the Live pill. */
export function reachLabel(reach: BroadcastReach, info: BroadcastReachInfo): string {
    switch (reach) {
        case "ROOM":
            return info.roomName;
        case "WORLD":
            return info.worldName ?? "";
        case "UNIVERSE":
            return info.universeName ?? "";
    }
}

export interface BroadcastCard {
    id: string;
    senderName: string;
    /** The sender's Woka, drawn on the card; empty from an older pusher, which shows a plain person instead. */
    senderTextures: CharacterTextureMessage[];
    /** "room", "world" or "universe", and the name of what it covers when the server knew it. */
    reach: string;
    reachLabel: string | undefined;
    /** The message as HTML (already converted from the editor's format), when there is one. */
    html: string | undefined;
    /** A voice note's audio, when there is one. */
    audioUrl: string | undefined;
    receivedAt: number;
}

let nextCardId = 0;

/** The broadcast cards received and not yet dismissed, newest first. */
function createBroadcastInboxStore() {
    const { subscribe, update, set } = writable<BroadcastCard[]>([]);
    return {
        subscribe,
        add(card: Omit<BroadcastCard, "id" | "receivedAt">): void {
            update((cards) => [{ ...card, id: `broadcast-${nextCardId++}`, receivedAt: Date.now() }, ...cards]);
        },
        dismiss(id: string): void {
            update((cards) => cards.filter((card) => card.id !== id));
        },
        clear(): void {
            set([]);
        },
    };
}

export const broadcastInboxStore = createBroadcastInboxStore();

export function broadcastMetaReach(
    meta: BroadcastMeta | undefined,
    fallback: string
): Pick<BroadcastCard, "reach" | "reachLabel" | "senderName" | "senderTextures"> {
    return {
        reach: meta?.reach ?? fallback,
        reachLabel: meta?.reachLabel || undefined,
        senderName: meta?.senderName || "",
        senderTextures: meta?.senderTextures ?? [],
    };
}

/** Opens the Broadcast card (closing anything it would hide under), or closes it when it is open. */
export function toggleBroadcastPanel(settings = false): void {
    if (get(broadcastPanelOpenStore) && !settings) {
        broadcastPanelOpenStore.set(false);
        return;
    }
    broadcastPanelSettingsStore.set(settings);
    broadcastPanelOpenStore.set(true);
}
