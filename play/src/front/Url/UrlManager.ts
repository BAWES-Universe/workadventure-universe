import type { Room } from "../Connection/Room";
import { localUserStore } from "../Connection/LocalUserStore";
import { pointManifestAtRoom } from "../Install/ManifestLink";

export enum GameConnexionTypes {
    room = 1,
    register /*@deprecated*/,
    empty,
    unknown,
    jwt /*@deprecated*/,
    login,
}

/** The current room's address, without its hash. */
let roomAddress: string | undefined;

function keepRoomAddress(): void {
    if (roomAddress === undefined || window.location.pathname === roomAddress.split("?")[0]) return;
    history.replaceState(history.state, "", roomAddress + window.location.hash);
}

//this class is responsible with analysing and editing the game's url
class UrlManager {
    public getGameConnexionType(): GameConnexionTypes {
        const url = window.location.pathname.toString();
        if (url === "/login") {
            return GameConnexionTypes.login;
        }
        //@deprecated jwt url will be replace by "?token=<private access token>"
        else if (url === "/jwt") {
            return GameConnexionTypes.jwt;
        } else if (url.includes("_/") || url.includes("*/") || url.includes("@/") || url.includes("~/")) {
            return GameConnexionTypes.room;
        }
        //@deprecated register url will be replaced by "?token=<private access token>"
        else if (url.includes("register/")) {
            return GameConnexionTypes.register;
        } else if (url === "/") {
            return GameConnexionTypes.empty;
        } else {
            return GameConnexionTypes.unknown;
        }
    }

    /**
     * @deprecated
     */
    public getOrganizationToken(): string | null {
        const match = /\/register\/(.+)/.exec(window.location.pathname.toString());
        return match ? match[1] : null;
    }

    /**
     * The room's address replaces the one the page opened on instead of adding to the history: the game never goes
     * back from room to room, and the address it opened on ("/" in the installed app) was the loading screen. On an
     * iPhone, a page with nothing to go back to also leaves the screen's left edge to the chat's own swipe (#1553).
     */
    public pushRoomIdToUrl(room: Room): void {
        const search = room.search.toString();
        roomAddress = room.id + (search ? "?" + search : "");
        // Back or Forward onto an entry made in an earlier room (a chat step, Orbit) keeps this room's address.
        window.removeEventListener("popstate", keepRoomAddress);
        window.addEventListener("popstate", keepRoomAddress);
        if (window.location.pathname === room.id) return;
        //Set last room visited! (connected or nor, must to be saved in local storage and cache API)
        //use href to keep # value
        localUserStore.setLastRoomUrl(room.href).catch((e) => console.error(e));
        history.replaceState(history.state, "WorkAdventure", roomAddress + window.location.hash);
        // The app installed from here must start in this room.
        pointManifestAtRoom(room.id);
    }

    public getStartPositionNameFromUrl(): string | undefined {
        const parameters = this.getHashParameters();
        for (const key in parameters) {
            if (parameters[key] === undefined) {
                return key;
            }
        }
        return undefined;
    }

    public getHashParameter(name: string): string | undefined {
        return this.getHashParameters()[name];
    }

    public clearHashParameter(): void {
        history.replaceState(history.state, document.title, window.location.pathname + window.location.search);
    }

    public getHashParameters(): Record<string, string> {
        return window.location.hash
            .substring(1)
            .split("&")
            .reduce((res: Record<string, string>, item: string) => {
                const parts = item.split("=");
                res[parts[0]] = parts[1];
                return res;
            }, {});
    }

    pushStartLayerNameToUrl(startLayerName: string): void {
        // Replaced, not added, like the room's address.
        const hash = startLayerName ? "#" + startLayerName.replace(/^#/, "") : "";
        history.replaceState(history.state, document.title, window.location.pathname + window.location.search + hash);
    }
}

export const urlManager = new UrlManager();
