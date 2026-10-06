import { describe, expect, it } from "vitest";
import { readable } from "svelte/store";
import { Color } from "@workadventure/shared-utils";
import type { ChatUser } from "../../Connection/ChatConnection";
import { indexColoursByChatId, indexWokasByChatId, personColour, personPicture } from "../ChatUserWokaStore";

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
        expect(personPicture(wokas, "@khalid:server", account)).toBe(live);
        expect(personPicture(wokas, "@bossman:server", account)).toBe(account);
        expect(personPicture(wokas, undefined, account)).toBe(account);
        expect(personPicture(new Map(), "@bossman:server", undefined)).toBeUndefined();
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
