import { describe, expect, it } from "vitest";
import { eventProcessor } from "../../src/pusher/models/eventProcessorInit";
import type { SpaceUserExtended } from "../../src/pusher/models/Space";

const user = (fields: Partial<SpaceUserExtended>) =>
    ({ spaceUserId: "user", megaphoneState: false, tags: [], ...fields } as unknown as SpaceUserExtended);

const listener = user({ spaceUserId: "listener" });

describe("Podium events", () => {
    for (const $case of ["inviteToSpeak", "moveToAudience"] as const) {
        describe($case, () => {
            const event = { $case, [$case]: {} } as Parameters<typeof eventProcessor.processPrivateEvent>[0];

            it("goes through from a speaker", () => {
                expect(eventProcessor.processPrivateEvent(event, user({ megaphoneState: true }), listener)).toBe(event);
            });

            it("goes through from an admin", () => {
                expect(eventProcessor.processPrivateEvent(event, user({ tags: ["admin"] }), listener)).toBe(event);
            });

            it("is refused from someone in the audience", () => {
                expect(() => eventProcessor.processPrivateEvent(event, user({}), listener)).toThrow();
            });
        });
    }

    it("lets anyone decline an invitation", () => {
        const event = { $case: "declineToSpeak", declineToSpeak: {} } as const;
        expect(eventProcessor.processPrivateEvent(event, listener, user({ megaphoneState: true }))).toBe(event);
    });
});
