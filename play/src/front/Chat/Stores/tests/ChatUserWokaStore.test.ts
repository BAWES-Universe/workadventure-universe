import { describe, expect, it, vi } from "vitest";
import { get, readable, writable } from "svelte/store";
import { Color } from "@workadventure/shared-utils";
import type { ChatUser } from "../../Connection/ChatConnection";
import type { UserProviderMerger } from "../../UserProviderMerger/UserProviderMerger";
import type { ChatPerson } from "../ChatPeopleStore";
import {
    createNameByChatIdStore,
    createPersonColourOf,
    createWokaByChatIdStore,
    indexColoursByChatId,
    indexNamesByChatId,
    indexWokasByChatId,
    personColour,
    personName,
    personPicture,
    withFetchedWokas,
} from "../ChatUserWokaStore";

function user(chatId: string, picture: string | undefined, color?: string): ChatUser {
    return {
        chatId,
        availabilityStatus: readable(0),
        username: chatId,
        pictureStore: picture === undefined ? undefined : readable(picture),
        roomName: undefined,
        playUri: undefined,
        color,
        spaceUserId: undefined,
    };
}

describe("indexWokasByChatId", () => {
    it("maps chat ids to their woka, first picture wins, people without one are skipped", () => {
        const wokas = indexWokasByChatId(
            new Map([
                ["map-a", { roomName: "A", users: [user("@omar:m", "omar.png"), user("@sara:m", undefined)] }],
                [undefined, { roomName: undefined, users: [user("@omar:m", "other.png"), user("@lea:m", "lea.png")] }],
            ])
        );
        expect([...wokas.keys()].sort()).toEqual(["@lea:m", "@omar:m"]);
        let omar: string | undefined;
        wokas.get("@omar:m")?.subscribe((value) => (omar = value))();
        expect(omar).toBe("omar.png");
    });
});

describe("personPicture", () => {
    const live = readable("live-woka.png");
    const account = readable("account-picture.png");

    it("prefers the woka the game sees right now, then the chat account's picture", () => {
        const wokas = new Map([["@khalid:server", live]]);
        expect(get(personPicture(wokas, "@khalid:server", account))).toBe("live-woka.png");
        expect(personPicture(wokas, "@khalid:server", undefined)).toBe(live);
        expect(personPicture(wokas, "@bossman:server", account)).toBe(account);
        expect(personPicture(wokas, undefined, account)).toBe(account);
        expect(personPicture(new Map(), "@bossman:server", undefined)).toBeUndefined();
    });

    it("shows the chat account's picture while the woka has none (its pictures could not be loaded)", () => {
        const failedWoka = writable<string | undefined>(undefined);
        const wokas = new Map([["@melon:server", failedWoka]]);
        const picture = personPicture(wokas, "@melon:server", account);
        expect(get(picture)).toBe("account-picture.png");
        failedWoka.set("melon-woka.png");
        expect(get(picture)).toBe("melon-woka.png");
        // The same pair gives the same store, so a list does not redraw.
        expect(personPicture(wokas, "@melon:server", account)).toBe(picture);
    });

    it("shows the chat account's picture before the Woka Orbit describes for someone outside the world", () => {
        const orbitWoka = writable<string | undefined>("orbit-woka.png");
        const wokas = withFetchedWokas(new Map(), new Map([["@melon:server", { picture: orbitWoka }]]));
        const savedPicture = writable<string | undefined>("melon-chat-picture.png");
        const picture = personPicture(wokas, "@melon:server", savedPicture);
        expect(get(picture)).toBe("melon-chat-picture.png");
        // No chat picture: Orbit's Woka fills in (a letter before #738).
        savedPicture.set(undefined);
        expect(get(picture)).toBe("orbit-woka.png");
        expect(personPicture(wokas, "@melon:server", savedPicture)).toBe(picture);
    });

    it("keeps the world's woka first for someone Orbit also described, then the chat picture, then Orbit's", () => {
        const world = writable<string | undefined>("world-woka.png");
        const orbitWoka = readable<string | undefined>("orbit-woka.png");
        const wokas = withFetchedWokas(
            new Map([["@away:server", world]]),
            new Map([["@away:server", { picture: orbitWoka }]])
        );
        const picture = personPicture(wokas, "@away:server", account);
        expect(get(picture)).toBe("world-woka.png");
        world.set(undefined);
        expect(get(picture)).toBe("account-picture.png");
    });
});

describe("indexColoursByChatId", () => {
    it("maps chat ids to the colour People shows them on, first colour wins, no colour or the local marker is skipped", () => {
        const colours = indexColoursByChatId(
            new Map([
                [
                    "map-a",
                    {
                        roomName: "A",
                        users: [user("@omar:m", undefined, "#4d9996"), user("@me:m", undefined, "local")],
                    },
                ],
                [
                    undefined,
                    { roomName: undefined, users: [user("@omar:m", undefined, "#000000"), user("@lea:m", undefined)] },
                ],
            ])
        );
        expect([...colours.entries()]).toEqual([["@omar:m", "#4d9996"]]);
    });
});

describe("personColour", () => {
    const colours = new Map([["@omar:m", "#4d9996"]]);

    it("uses the colour the game gave them, else the same rule on their name", () => {
        expect(personColour(colours, "@omar:m", "Omar")).toBe("#4d9996");
        expect(personColour(colours, "@sara:m", "Sara")).toBe(Color.getColorByString("Sara"));
        expect(personColour(colours, undefined, "Sara")).toBe(Color.getColorByString("Sara"));
    });

    it("gives nothing without a chat id match or a name", () => {
        expect(personColour(colours, "@sara:m", undefined)).toBeUndefined();
        expect(personColour(colours, undefined, "")).toBeUndefined();
    });
});

describe("indexNamesByChatId", () => {
    it("maps chat ids to the name they go by in Universe, never the chat account's, first name wins", () => {
        const names = indexNamesByChatId(
            new Map([
                [
                    "map-a",
                    {
                        roomName: "A",
                        users: [
                            { ...user("@omar:m", undefined), username: "Omar (chat)", gameName: "Omar" },
                            { ...user("@sara:m", undefined), username: "Sara (chat)" },
                        ],
                    },
                ],
                [undefined, { roomName: undefined, users: [{ ...user("@omar:m", undefined), gameName: "Other" }] }],
            ])
        );
        expect([...names.entries()]).toEqual([["@omar:m", "Omar"]]);
    });
});

describe("personName", () => {
    const names = new Map([["@khalid:m", "Khal"]]);

    it("uses the name they go by in Universe now, else the chat room's name", () => {
        expect(personName(names, "@khalid:m", "Khalid Al-Mutawa")).toBe("Khal");
        expect(personName(names, "@sara:m", "Sara")).toBe("Sara");
        expect(personName(names, undefined, "Sara")).toBe("Sara");
    });
});

/** The latest value of a store that needs a standing subscription (its source arrives later). */
function valueOf<T>(store: { subscribe: (run: (value: T) => void) => () => void }) {
    const holder = { current: undefined as unknown as T, stop: () => undefined as void };
    holder.stop = store.subscribe((value) => (holder.current = value));
    return holder;
}

describe("people outside the world, asked of Orbit", () => {
    const orbit = (name: string | undefined, picture: string | undefined): ChatPerson => ({
        name,
        picture: picture === undefined ? undefined : readable(picture),
    });

    it("fill in the Woka for a chat partner the world has no picture for, and never replace one it has", () => {
        const world = readable("world.png");
        const account = readable<string | undefined>(undefined);
        const wokas = new Map([
            ["@live:m", world],
            ["@chatonly:m", account],
        ]);
        const result = withFetchedWokas(
            wokas,
            new Map([
                ["@live:m", orbit(undefined, "orbit-live.png")],
                ["@chatonly:m", orbit(undefined, "orbit.png")],
                ["@away:m", orbit(undefined, "orbit-away.png")],
                ["@named:m", orbit("Only a name", undefined)],
            ])
        );
        expect(get(result.get("@live:m")!)).toBe("world.png");
        expect(get(result.get("@chatonly:m")!)).toBe("orbit.png");
        expect(get(result.get("@away:m")!)).toBe("orbit-away.png");
        expect(result.has("@named:m")).toBe(false);
        // The map it was given is not changed.
        expect(wokas.has("@away:m")).toBe(false);
    });

    it("leaves the map alone when Orbit has nothing to add", () => {
        const wokas = new Map([["@live:m", readable("world.png")]]);
        expect(withFetchedWokas(wokas, new Map())).toBe(wokas);
    });

    function fakeMerger(users: ChatUser[]): Promise<UserProviderMerger> {
        return Promise.resolve({
            usersByRoomStore: readable(new Map([["map", { roomName: "Map", users }]])),
        } as unknown as UserProviderMerger);
    }

    it("reach the Woka lookup the header, the list and the profile all read (a letter before)", async () => {
        const stranger = { ...user("@stranger:m", undefined), pictureStore: readable<string | undefined>(undefined) };
        const people = readable(new Map([["@stranger:m", orbit("Stranger Danger", "orbit.png")]]));
        const wokas = valueOf(createWokaByChatIdStore(fakeMerger([stranger]), people));
        await vi.waitFor(() =>
            expect(get(personPicture(wokas.current, "@stranger:m", undefined) ?? readable(undefined))).toBe("orbit.png")
        );
        // Someone nobody knows stays without a picture, so the caller shows its letter or the room picture.
        expect(personPicture(wokas.current, "@unknown:m", undefined)).toBeUndefined();
        wokas.stop();
    });

    it("name them when the world has no name for them, after a rename in the game wins over the chat room's name", async () => {
        const renamed = { ...user("@renamed:m", undefined), username: "Old chat name", gameName: "New name" };
        const people = readable(
            new Map([
                ["@stranger:m", orbit("Stranger Danger", undefined)],
                ["@renamed:m", orbit("Ignored", undefined)],
            ])
        );
        const names = valueOf(createNameByChatIdStore(fakeMerger([renamed]), people));
        await vi.waitFor(() => expect(names.current.get("@renamed:m")).toBe("New name"));
        expect(personName(names.current, "@stranger:m", "Chat room name")).toBe("Stranger Danger");
        expect(personName(names.current, "@unknown:m", "Chat room name")).toBe("Chat room name");
        names.stop();
    });

    it("work without Orbit's people (no connection yet) exactly as before", async () => {
        const names = valueOf(createNameByChatIdStore(fakeMerger([{ ...user("@a:m", undefined), gameName: "A" }])));
        await vi.waitFor(() => expect(names.current.get("@a:m")).toBe("A"));
        names.stop();
    });
});

describe("createPersonColourOf", () => {
    const merger = (users: ChatUser[]) =>
        Promise.resolve({
            usersByRoomStore: readable(new Map([["map", { roomName: "Map", users }]])),
        } as unknown as UserProviderMerger);

    it("gives a proximity chat's people the same colour as their direct chat row", async () => {
        const colourOf = valueOf(createPersonColourOf(merger([user("@bot_7:m", "/w/bot.png", "#4d9996")])));
        await vi.waitFor(() => expect(colourOf.current("@bot_7:m", "GitHub")).toBe("#4d9996"));
        expect(colourOf.current("@sara:m", "Sara")).toBe(Color.getColorByString("Sara"));
        colourOf.stop();
    });

    it("still colours by name before the game's people are known", () => {
        const colourOf = valueOf(createPersonColourOf(undefined));
        expect(colourOf.current(undefined, "Sales Researcher")).toBe(Color.getColorByString("Sales Researcher"));
        colourOf.stop();
    });
});
