import { describe, it, expect } from "vitest";
import type { SpaceUserExtended } from "../../src/pusher/models/Space";
import { eventProcessor } from "../../src/pusher/models/eventProcessorInit";

function spaceUser(spaceUserId: string, tags: string[]): SpaceUserExtended {
    return { spaceUserId, name: spaceUserId, lowercaseName: spaceUserId, tags } as unknown as SpaceUserExtended;
}

describe("eventProcessorInit", () => {
    describe("kickOffUser", () => {
        const kickOffUser = { $case: "kickOffUser" as const, kickOffUser: {} };
        const speaker = spaceUser("speaker", []);

        it("lets an admin kick off a user", () => {
            expect(eventProcessor.processPrivateEvent(kickOffUser, spaceUser("admin", ["admin"]), speaker)).toEqual(
                kickOffUser
            );
        });

        it("refuses a kick from a player who is not an admin", () => {
            expect(() =>
                eventProcessor.processPrivateEvent(kickOffUser, spaceUser("player", ["member", "editor"]), speaker)
            ).toThrow("Only admins can kick off a user");
        });
    });
});
