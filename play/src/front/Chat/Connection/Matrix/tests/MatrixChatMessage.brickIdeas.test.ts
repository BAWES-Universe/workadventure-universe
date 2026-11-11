import { get } from "svelte/store";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MatrixEvent, Room } from "matrix-js-sdk";

vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: (member: { userId: string } | null) => (member ? { chatId: member.userId } : undefined),
}));

import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import { MatrixChatMessage } from "../MatrixChatMessage";

const ME = "@me:matrix.test";
const BRICK = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";
const SENT = "A few things I could take off your plate. Pick one, or just ask in your own words.";

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

describe('a Brick\'s fixed "what I can do" answer (#1995)', () => {
    it("keeps the words it was sent with while no language is loaded", () => {
        const answer = message(BRICK, { msgtype: "m.text", body: SENT, "universe.brick_ideas": true });
        expect(answer.brickIdeas).toBe(true);
        expect(get(answer.content).body).toBe(SENT);
    });

    describe("once the game has its language", () => {
        beforeAll(() => {
            loadLocale("en-US");
            setLocale("en-US");
        });

        it("is marked, so the chat shows its ideas under it, and reads in the person's own language", () => {
            const answer = message(BRICK, {
                msgtype: "m.text",
                body: "Whatever the bot server wrote",
                "universe.brick_ideas": true,
            });
            expect(answer.brickIdeas).toBe(true);
            expect(get(answer.content).body).toBe(SENT);
        });

        it("is never an ordinary reply, which keeps its own words", () => {
            const reply = message(BRICK, { msgtype: "m.text", body: "Here is your summary." });
            expect(reply.brickIdeas).toBe(false);
            expect(get(reply.content).body).toBe("Here is your summary.");
        });

        it("is never a person's message, even one that carries the mark", () => {
            const mine = message(ME, {
                msgtype: "m.text",
                body: "What can you do for me?",
                "universe.brick_ideas": true,
            });
            expect(mine.brickIdeas).toBe(false);
            expect(get(mine.content).body).toBe("What can you do for me?");
        });
    });
});
