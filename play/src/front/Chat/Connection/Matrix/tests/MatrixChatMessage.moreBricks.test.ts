import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { MatrixEvent, Room } from "matrix-js-sdk";

vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: (member: { userId: string } | null) => (member ? { chatId: member.userId } : undefined),
}));

import { MatrixChatMessage } from "../MatrixChatMessage";

const ME = "@me:matrix.test";
const BRICK = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";
const MADE = "1c8d2e3f-2222-4333-8444-a55566667777";

function textEvent(sender: string, content: Record<string, unknown>): MatrixEvent {
    return {
        getId: () => "$answer",
        getDate: () => new Date(161_000),
        localTimestamp: 101_000,
        getSender: () => sender,
        getOriginalContent: () => content,
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        replyEventId: undefined,
        on: () => {},
    } as unknown as MatrixEvent;
}

function fakeRoom(): Room {
    return {
        client: {
            getUserId: () => ME,
            getSafeUserId: () => ME,
            getUser: () => null,
        },
        getMember: (userId: string) => ({ userId, powerLevelNorm: 0 }),
        getLiveTimeline: () => ({
            getState: () => ({ hasSufficientPowerLevelFor: () => false }),
        }),
        getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    } as unknown as Room;
}

const message = (sender: string, content: Record<string, unknown>) =>
    new MatrixChatMessage(textEvent(sender, content), fakeRoom(), sender === ME, true);

const offer = {
    topic: "recipes",
    ask: "You cook a lot. Want a Brick just for recipes?",
    name: "Recipe Brick",
    line: "It keeps your recipes in one place",
    instructions: "You keep recipes.",
};

describe("more Bricks in a Brick's chat (#1996)", () => {
    it("knows the Bricks an answer made, and keeps the answer's own words", () => {
        const answer = message(BRICK, {
            msgtype: "m.text",
            body: "Done. Recipe Brick is ready and knows its job.",
            "universe.brick_made": [
                { id: MADE, name: "Recipe Brick", line: "Keeps your mum's recipes", look: "brick-red", made: true },
            ],
        });
        expect(answer.brickMade).toEqual([
            { id: MADE, name: "Recipe Brick", line: "Keeps your mum's recipes", look: "brick-red", made: true },
        ]);
        expect(answer.brickOffer).toBeUndefined();
        expect(get(answer.content).body).toBe("Done. Recipe Brick is ready and knows its job.");
    });

    it("knows a Brick's suggestion, with what Make it sends back", () => {
        const card = message(BRICK, { msgtype: "m.text", body: offer.ask, "universe.brick_offer": offer });
        expect(card.brickOffer).toEqual(offer);
        expect(card.brickMade).toEqual([]);
        expect(get(card.content).body).toBe(offer.ask);
    });

    it("takes neither from a person's own message", () => {
        const mine = message(ME, {
            msgtype: "m.text",
            body: "hello",
            "universe.brick_offer": offer,
            "universe.brick_made": [{ id: MADE, name: "Recipe Brick" }],
        });
        expect(mine.brickOffer).toBeUndefined();
        expect(mine.brickMade).toEqual([]);
    });
});
