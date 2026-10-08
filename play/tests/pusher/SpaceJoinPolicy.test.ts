import { FilterType } from "@workadventure/messages";
import { describe, expect, it } from "vitest";
import {
    checkSpaceJoin,
    SpaceJoinRefusedError,
    toWorldSpaceName,
    WORLD_SPACE_NAME,
} from "../../src/pusher/services/SpaceJoinPolicy";

const BUBBLE = "http://play.example.com/@/team/world/room#12#1700000000000";
const OTHER_BUBBLE = "http://play.example.com/@/team/world/room#13#1700000000001";
const MEGAPHONE = "playexamplecom--team-world-room-megaphone-room";
const OTHER_ROOM_MEGAPHONE = "playexamplecom--team-world-other-megaphone-room";
const MEDIA = ["cameraState", "microphoneState", "screenSharingState"];

function socketData(
    granted: string[] = [],
    megaphoneChannels: Map<string, boolean> | undefined = new Map([[MEGAPHONE, true]])
) {
    return { grantedBubbleSpaces: new Set(granted), megaphoneChannels };
}

function join(localSpaceName: string, filterType = FilterType.ALL_USERS, propertiesToSync: string[] = []) {
    return { localSpaceName, filterType, propertiesToSync };
}

describe("checkSpaceJoin", () => {
    describe("bubbles", () => {
        it("lets a member join the bubble the back asked it to join", () => {
            expect(() => checkSpaceJoin(join(BUBBLE, FilterType.ALL_USERS, MEDIA), socketData([BUBBLE]))).not.toThrow();
        });

        it("refuses a bubble the back did not ask this player to join", () => {
            expect(() => checkSpaceJoin(join(OTHER_BUBBLE, FilterType.ALL_USERS, MEDIA), socketData([BUBBLE]))).toThrow(
                SpaceJoinRefusedError
            );
        });

        it("refuses a bubble once the back asked the player to leave it", () => {
            const data = socketData([BUBBLE]);
            data.grantedBubbleSpaces.delete(BUBBLE);
            expect(() => checkSpaceJoin(join(BUBBLE, FilterType.ALL_USERS, MEDIA), data)).toThrow(
                SpaceJoinRefusedError
            );
        });

        it("refuses any name with a # that is not a granted bubble (map scripts included)", () => {
            expect(() => checkSpaceJoin(join("my#space"), socketData())).toThrow(SpaceJoinRefusedError);
        });

        it("refuses a granted bubble joined as a live streaming space", () => {
            expect(() => checkSpaceJoin(join(BUBBLE, FilterType.LIVE_STREAMING_USERS), socketData([BUBBLE]))).toThrow(
                SpaceJoinRefusedError
            );
        });
    });

    describe("world space", () => {
        it("lets anyone join with the usual properties", () => {
            expect(() =>
                checkSpaceJoin(
                    join(WORLD_SPACE_NAME, FilterType.ALL_USERS, ["availabilityStatus", "chatID"]),
                    socketData()
                )
            ).not.toThrow();
        });

        it("refuses the world space with camera or microphone properties", () => {
            expect(() =>
                checkSpaceJoin(
                    join(WORLD_SPACE_NAME, FilterType.ALL_USERS, ["availabilityStatus", "chatID", "cameraState"]),
                    socketData()
                )
            ).toThrow(SpaceJoinRefusedError);
        });

        it("refuses the world space as a live streaming space", () => {
            expect(() =>
                checkSpaceJoin(
                    join(WORLD_SPACE_NAME, FilterType.LIVE_STREAMING_USERS, ["availabilityStatus"]),
                    socketData()
                )
            ).toThrow(SpaceJoinRefusedError);
        });
    });

    describe("broadcast channel spaces", () => {
        it("lets anyone join one as a live streaming space", () => {
            expect(() =>
                checkSpaceJoin(join(MEGAPHONE, FilterType.LIVE_STREAMING_USERS, MEDIA), socketData())
            ).not.toThrow();
        });

        it("refuses one as a space listing all users", () => {
            expect(() => checkSpaceJoin(join(MEGAPHONE, FilterType.ALL_USERS, MEDIA), socketData())).toThrow(
                SpaceJoinRefusedError
            );
        });

        it("refuses another room's channel as a space listing all users too", () => {
            expect(() => checkSpaceJoin(join(OTHER_ROOM_MEGAPHONE, FilterType.ALL_USERS, MEDIA), socketData())).toThrow(
                SpaceJoinRefusedError
            );
        });
    });

    describe("other spaces stay open", () => {
        it.each([
            ["a meeting area", "1a2b3c-meeting-room", FilterType.ALL_USERS],
            ["a speaker zone", "1a2b3c-stage", FilterType.LIVE_STREAMING_USERS],
            ["a map script space", "my-script-space", FilterType.ALL_USERS],
            [
                "a Matrix area space (joined by the server)",
                "matrix-area:!abcDEF:matrix.example.com",
                FilterType.ALL_USERS,
            ],
        ])("allows %s", (_label, name, filterType) => {
            expect(() => checkSpaceJoin(join(name, filterType, MEDIA), socketData())).not.toThrow();
        });
    });
});

describe("toWorldSpaceName", () => {
    it("prefixes the name with the world, as the pusher names spaces", () => {
        expect(toWorldSpaceName("my-world", BUBBLE)).toBe(`my-world.${BUBBLE}`);
    });
});
