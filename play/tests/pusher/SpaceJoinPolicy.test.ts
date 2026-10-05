import { FilterType } from "@workadventure/messages";
import { describe, expect, it } from "vitest";
import { areaSpaceName } from "@workadventure/shared-utils/src/Space/areaSpaceName";
import {
    checkSpaceJoin,
    SpaceJoinRefusedError,
    toWorldSpaceName,
    WORLD_SPACE_NAME,
} from "../../src/pusher/services/SpaceJoinPolicy";

const BUBBLE = "http://play.example.com/@/team/world/room#12#1700000000000";
const OTHER_BUBBLE = "http://play.example.com/@/team/world/room#13#1700000000001";
const MEGAPHONE = "playexamplecom-megaphone-news";
const MEDIA = ["cameraState", "microphoneState", "screenSharingState"];
const ROOM = "http://play.example.com/@/team/world/room";
const PRIVATE_ROOM = "http://play.example.com/@/team/world/private-room";

function socketData(granted: string[] = [], megaphoneSpaceName: string | null | undefined = MEGAPHONE) {
    return { grantedBubbleSpaces: new Set(granted), megaphoneSpaceName, roomId: ROOM };
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

    describe("megaphone space", () => {
        it("lets anyone join it as a live streaming space", () => {
            expect(() =>
                checkSpaceJoin(join(MEGAPHONE, FilterType.LIVE_STREAMING_USERS, MEDIA), socketData())
            ).not.toThrow();
        });

        it("refuses it as a space listing all users", () => {
            expect(() => checkSpaceJoin(join(MEGAPHONE, FilterType.ALL_USERS, MEDIA), socketData())).toThrow(
                SpaceJoinRefusedError
            );
        });

        it("does not restrict that name in a room without a megaphone", () => {
            expect(() => checkSpaceJoin(join(MEGAPHONE, FilterType.ALL_USERS), socketData([], null))).not.toThrow();
        });
    });

    describe("meeting rooms and speaker zones", () => {
        it.each([
            ["a meeting room", areaSpaceName("Meeting room", ROOM), FilterType.ALL_USERS],
            ["a speaker zone", areaSpaceName("Stage", ROOM), FilterType.LIVE_STREAMING_USERS],
        ])("lets a player into %s of their room", (_label, name, filterType) => {
            expect(() => checkSpaceJoin(join(name, filterType, MEDIA), socketData())).not.toThrow();
        });

        it.each([
            ["a meeting room", areaSpaceName("Meeting room", PRIVATE_ROOM), FilterType.ALL_USERS],
            ["a speaker zone", areaSpaceName("Stage", PRIVATE_ROOM), FilterType.LIVE_STREAMING_USERS],
        ])("refuses %s of another room", (_label, name, filterType) => {
            expect(() => checkSpaceJoin(join(name, filterType, MEDIA), socketData())).toThrow(/in another room/);
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
