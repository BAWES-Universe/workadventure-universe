import { describe, expect, it } from "vitest";
import { get, readable } from "svelte/store";
import type { ChatMessage } from "../../../../Connection/ChatConnection";
import type { ProximitySession } from "../../../../Connection/Proximity/ProximitySessions";
import { ROOM_MESSAGES_SESSION_ID } from "../../../../Connection/Proximity/ProximitySessions";
import { endedConversation } from "../NearbyConversation";

const said = (name: string, chatId: string, picture: string) =>
    ({
        isMyMessage: false,
        sender: { username: name, chatId, pictureStore: readable(picture) },
    } as unknown as ChatMessage);

function session(extra: Partial<ProximitySession<ChatMessage>> = {}): ProximitySession<ChatMessage> {
    return {
        id: "stay-1",
        stayIds: ["stay-1"],
        index: 1,
        label: "GitHub [StudentHub]",
        participants: ["GitHub [StudentHub]", "Sara"],
        participantIds: ["space-1", "space-2"],
        isArea: false,
        startedAt: 1,
        endedAt: 2,
        entries: [],
        messages: [said("GitHub [StudentHub]", "@bot_12:chat.bawes.net", "/github.png")],
        lastMessage: undefined,
        unsentDraft: undefined,
        isLive: false,
        ...extra,
    };
}

const names = (people: string[]) => people.join(" & ");

describe("an ended proximity chat's details (#1615)", () => {
    it("are about who you were with and when it ended", () => {
        const ended = endedConversation(session(), names);
        expect(ended?.title).toBe("GitHub [StudentHub] & Sara");
        expect(ended?.endedAt).toBe(2);
        expect(ended?.people.map((person) => [person.id, person.name, person.chatId])).toEqual([
            ["space-1", "GitHub [StudentHub]", "@bot_12:chat.bawes.net"],
            ["space-2", "Sara", undefined],
        ]);
        expect(ended && get(ended.people[0].pictureStore)).toBe("/github.png");
        expect(ended && get(ended.people[1].pictureStore)).toBeUndefined();
    });

    it("are named after a meeting's area", () => {
        expect(endedConversation(session({ isArea: true, label: "Design room" }), names)?.title).toBe("Design room");
    });

    it("are not about the live chat, the room messages or the whole timeline", () => {
        expect(endedConversation(session({ isLive: true }), names)).toBeUndefined();
        expect(endedConversation(session({ id: ROOM_MESSAGES_SESSION_ID }), names)).toBeUndefined();
        expect(endedConversation(undefined, names)).toBeUndefined();
    });
});
