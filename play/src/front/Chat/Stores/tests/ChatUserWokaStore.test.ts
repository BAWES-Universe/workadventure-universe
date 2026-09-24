import { describe, expect, it } from "vitest";
import { readable } from "svelte/store";
import type { ChatUser } from "../../Connection/ChatConnection";
import { indexWokasByChatId } from "../ChatUserWokaStore";

function user(chatId: string, picture: string | undefined): ChatUser {
    return {
        chatId,
        availabilityStatus: readable(0),
        username: chatId,
        pictureStore: picture === undefined ? undefined : readable(picture),
        roomName: undefined,
        playUri: undefined,
        color: undefined,
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
