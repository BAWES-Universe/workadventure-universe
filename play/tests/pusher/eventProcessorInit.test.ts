import { describe, it, expect } from "vitest";
import { Permission } from "@workadventure/shared-utils/src/Permissions/permissions";
import type { SpaceUserExtended } from "../../src/pusher/models/Space";
import { eventProcessor } from "../../src/pusher/models/eventProcessorInit";

function spaceUser(spaceUserId: string, tags: string[], permissions?: string): SpaceUserExtended {
    return {
        spaceUserId,
        name: spaceUserId,
        lowercaseName: spaceUserId,
        tags,
        permissions,
    } as unknown as SpaceUserExtended;
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
            ).toThrow("Needs the Moderate calls permission to kick someone off a call");
        });

        it("follows the permissions Orbit sent over the tags", () => {
            const moderate = String(1 << Permission.MODERATE_CALLS);
            expect(
                eventProcessor.processPrivateEvent(kickOffUser, spaceUser("moderator", ["member"], moderate), speaker)
            ).toEqual(kickOffUser);
            expect(() =>
                eventProcessor.processPrivateEvent(kickOffUser, spaceUser("demoted", ["admin"], "0"), speaker)
            ).toThrow("Needs the Moderate calls permission");
        });
    });

    describe("individual mute", () => {
        const receiver = spaceUser("receiver", []);

        it.each([
            ["muteAudio", { $case: "muteAudio" as const, muteAudio: { force: true } }],
            ["muteVideo", { $case: "muteVideo" as const, muteVideo: { force: true } }],
        ])("%s from a player who is not an admin stays a request, whatever the browser sent", (_name, event) => {
            const processed = eventProcessor.processPrivateEvent(event, spaceUser("player", ["member"]), receiver);
            const force = processed.$case === "muteAudio" ? processed.muteAudio.force : undefined;
            const forceVideo = processed.$case === "muteVideo" ? processed.muteVideo.force : undefined;
            expect(force ?? forceVideo).toBe(false);
        });

        it.each([
            ["muteAudio", { $case: "muteAudio" as const, muteAudio: { force: false } }],
            ["muteVideo", { $case: "muteVideo" as const, muteVideo: { force: false } }],
        ])("%s from an admin is imposed", (_name, event) => {
            const processed = eventProcessor.processPrivateEvent(event, spaceUser("admin", ["admin"]), receiver);
            const force = processed.$case === "muteAudio" ? processed.muteAudio.force : undefined;
            const forceVideo = processed.$case === "muteVideo" ? processed.muteVideo.force : undefined;
            expect(force ?? forceVideo).toBe(true);
        });
    });
});
