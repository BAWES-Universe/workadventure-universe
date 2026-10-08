import { FilterType } from "@workadventure/messages";
import { describe, expect, it } from "vitest";
import { areaSpaceName } from "@workadventure/shared-utils/src/Space/areaSpaceName";
import {
    checkSpaceJoin,
    SpaceJoinRefusedError,
    toServerSpaceName,
    toWorldSpaceName,
    WORLD_SPACE_NAME,
} from "../../src/pusher/services/SpaceJoinPolicy";

const BUBBLE = "http://play.example.com/@/team/world/room#12#1700000000000";
const OTHER_BUBBLE = "http://play.example.com/@/team/world/room#13#1700000000001";
const MEGAPHONE = "playexamplecom--team-world-room-megaphone-room";
const OTHER_ROOM_MEGAPHONE = "playexamplecom--team-world-other-megaphone-room";
const MEDIA = ["cameraState", "microphoneState", "screenSharingState"];
const ROOM = "http://play.example.com/@/team/world/room";
const PRIVATE_ROOM = "http://play.example.com/@/team/world/private-room";

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

    describe("meeting rooms and speaker zones", () => {
        it.each([
            ["a meeting room", areaSpaceName("Meeting room", ROOM), FilterType.ALL_USERS],
            ["a speaker zone", areaSpaceName("Stage", ROOM), FilterType.LIVE_STREAMING_USERS],
        ])("lets a player into %s", (_label, name, filterType) => {
            expect(() => checkSpaceJoin(join(name, filterType, MEDIA), socketData())).not.toThrow();
        });
    });

    describe("when the back could not read the room's areas yet", () => {
        const unknown = { ...socketData(), areaSpacePolicyUnknown: true };

        it("refuses meeting rooms and speaker zones, which could be limited", () => {
            expect(() =>
                checkSpaceJoin(join(areaSpaceName("Meeting room", ROOM), FilterType.ALL_USERS, MEDIA), unknown)
            ).toThrow(SpaceJoinRefusedError);
            expect(() =>
                checkSpaceJoin(join(areaSpaceName("Stage", ROOM), FilterType.LIVE_STREAMING_USERS, MEDIA), unknown)
            ).toThrow(SpaceJoinRefusedError);
        });

        it("keeps everything else open", () => {
            expect(() => checkSpaceJoin(join("my-script-space", FilterType.ALL_USERS, MEDIA), unknown)).not.toThrow();
            expect(() =>
                checkSpaceJoin(join(MEGAPHONE, FilterType.LIVE_STREAMING_USERS, MEDIA), unknown)
            ).not.toThrow();
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

describe("toServerSpaceName", () => {
    const inRoom = { world: "team~world", roomId: ROOM };
    const inPrivateRoom = { world: "team~world", roomId: PRIVATE_ROOM };

    it("puts the world in front of the spaces every room of the world shares", () => {
        expect(toServerSpaceName(inRoom, WORLD_SPACE_NAME)).toBe(toWorldSpaceName("team~world", WORLD_SPACE_NAME));
        expect(toServerSpaceName(inRoom, "my-script-space")).toBe(toServerSpaceName(inPrivateRoom, "my-script-space"));
    });

    it("keeps meeting rooms and speaker zones in the player's own room", () => {
        const privateStage = areaSpaceName("Stage", PRIVATE_ROOM);
        // A player in ROOM asking for the private room's stage by its exact name still lands in a space of ROOM.
        expect(toServerSpaceName(inRoom, privateStage)).not.toBe(toServerSpaceName(inPrivateRoom, privateStage));
    });

    it("gives every player of a room the same meeting room", () => {
        const stage = areaSpaceName("Stage", ROOM);
        expect(toServerSpaceName(inRoom, stage)).toBe(toServerSpaceName({ ...inRoom }, stage));
        expect(toServerSpaceName(inRoom, stage).startsWith("team~world.area__")).toBe(true);
    });

    it("never gives a meeting room the name of another space", () => {
        const stage = areaSpaceName("Stage", ROOM);
        const serverName = toServerSpaceName(inRoom, stage);
        const localPart = serverName.slice("team~world.".length);
        // Sending the server name's own local part does not reach the same space: the room is added again.
        expect(toServerSpaceName(inRoom, localPart)).not.toBe(serverName);
    });
});
