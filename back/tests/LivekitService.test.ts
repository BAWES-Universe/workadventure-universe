import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceUser } from "@workadventure/messages";
import type { EgressClient, RoomServiceClient } from "livekit-server-sdk";
import { TokenVerifier, TrackSource } from "livekit-server-sdk";
import * as Sentry from "@sentry/node";
import type { PublishRight } from "../src/Model/Services/LivekitService";
import { LiveKitService } from "../src/Model/Services/LivekitService";

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

const HOST = "http://livekit";
const API_KEY = "key";
const API_SECRET = "secret-secret-secret-secret-secret-1234";
const FRONTEND_URL = "ws://livekit";

const SHORT_ROOM = "universe/world/room";
/** One character over the limit, so the service sends the media server a hash instead of the name itself. */
const LONG_ROOM = "r".repeat(251);
const LONG_ROOM_HASH = crypto.createHash("sha256").update(LONG_ROOM).digest("hex");

function makeRoomService() {
    return {
        listRooms: vi.fn().mockResolvedValue([]),
        createRoom: vi.fn().mockResolvedValue(undefined),
        deleteRoom: vi.fn().mockResolvedValue(undefined),
        listParticipants: vi.fn().mockResolvedValue([]),
        removeParticipant: vi.fn().mockResolvedValue(undefined),
        updateParticipant: vi.fn().mockResolvedValue(undefined),
    };
}

function makeEgress() {
    return {
        startRoomCompositeEgress: vi.fn().mockResolvedValue({ egressId: "egress-1" }),
        stopEgress: vi.fn().mockResolvedValue(undefined),
    };
}

function makeService(
    roomService = makeRoomService(),
    egress = makeEgress(),
    frontendUrl = FRONTEND_URL
): LiveKitService {
    return new LiveKitService(
        HOST,
        API_KEY,
        API_SECRET,
        frontendUrl,
        () => roomService as unknown as RoomServiceClient,
        () => egress as unknown as EgressClient
    );
}

const user = SpaceUser.fromPartial({ spaceUserId: "space-user-7", uuid: "uuid-7", name: "Display Name" });

async function decode(token: string) {
    return new TokenVerifier(API_KEY, API_SECRET).verify(token);
}

describe("LiveKitService", () => {
    beforeEach(() => {
        vi.mocked(Sentry.captureException).mockClear();
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("constructor", () => {
        it.each([
            ["host", "", API_KEY, API_SECRET],
            ["api key", HOST, "", API_SECRET],
            ["api secret", HOST, API_KEY, ""],
        ])("refuses a missing %s", (_label, host, key, secret) => {
            const createRoomService = vi.fn();
            const createEgress = vi.fn();
            expect(() => new LiveKitService(host, key, secret, FRONTEND_URL, createRoomService, createEgress)).toThrow(
                "Livekit host, api key or secret is not set"
            );
            expect(createRoomService).not.toHaveBeenCalled();
            expect(createEgress).not.toHaveBeenCalled();
        });

        it("builds the room and egress clients with the host, key and secret", () => {
            const createRoomService = vi.fn().mockReturnValue(makeRoomService());
            const createEgress = vi.fn().mockReturnValue(makeEgress());
            new LiveKitService(HOST, API_KEY, API_SECRET, FRONTEND_URL, createRoomService, createEgress);
            expect(createRoomService).toHaveBeenCalledWith(HOST, API_KEY, API_SECRET);
            expect(createEgress).toHaveBeenCalledWith(HOST, API_KEY, API_SECRET);
        });
    });

    describe("generateToken", () => {
        it("signs the token with the API key and secret, under the space user id, with name and metadata", async () => {
            const token = await makeService().generateToken(SHORT_ROOM, user, "everything");
            const claims = await decode(token);

            expect(claims.iss).toBe(API_KEY);
            expect(claims.sub).toBe("space-user-7");
            expect(claims.name).toBe("Display Name");
            expect(JSON.parse(claims.metadata ?? "")).toEqual({ userId: "space-user-7", uuid: "uuid-7" });
        });

        it("refuses to verify with another secret", async () => {
            const token = await makeService().generateToken(SHORT_ROOM, user, "everything");
            await expect(
                new TokenVerifier(API_KEY, "another-secret-another-secret-123456").verify(token)
            ).rejects.toThrow();
        });

        it("expires six hours after it is made (the SDK default)", async () => {
            const before = Math.floor(Date.now() / 1000);
            const claims = await decode(await makeService().generateToken(SHORT_ROOM, user, "everything"));
            const after = Math.floor(Date.now() / 1000);

            expect(claims.exp).toBeGreaterThanOrEqual(before + 6 * 60 * 60);
            expect(claims.exp).toBeLessThanOrEqual(after + 6 * 60 * 60);
        });

        it("names the room as given up to 250 characters", async () => {
            const room = "x".repeat(250);
            const claims = await decode(await makeService().generateToken(room, user, "everything"));
            expect(claims.video?.room).toBe(room);
        });

        it("names a room over 250 characters by the sha256 hex of its name", async () => {
            const claims = await decode(await makeService().generateToken(LONG_ROOM, user, "everything"));
            expect(claims.video?.room).toBe(LONG_ROOM_HASH);
        });

        const cases: [PublishRight, boolean, TrackSource[]][] = [
            [
                "everything",
                true,
                [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
            ],
            ["camera", true, [TrackSource.CAMERA]],
            ["microphone", true, [TrackSource.MICROPHONE]],
            ["nothing", false, []],
        ];

        it.each(cases)("grants publish right %s", async (right, canPublish, sources) => {
            const claims = await decode(await makeService().generateToken(SHORT_ROOM, user, right));
            const expectedSources = sources.map((source) => TrackSource[source].toLowerCase());

            expect(claims.video?.roomJoin).toBe(true);
            expect(claims.video?.canSubscribe).toBe(true);
            expect(claims.video?.canPublish).toBe(canPublish);
            expect(claims.video?.canPublishSources ?? []).toEqual(expectedSources);
        });
    });

    describe("createRoom", () => {
        it("does nothing when the room already exists", async () => {
            const roomService = makeRoomService();
            roomService.listRooms.mockResolvedValue([{ name: SHORT_ROOM }]);

            await makeService(roomService).createRoom(SHORT_ROOM);

            expect(roomService.listRooms).toHaveBeenCalledWith([SHORT_ROOM]);
            expect(roomService.createRoom).not.toHaveBeenCalled();
        });

        it.each([[[]], [undefined]])("creates the room under its name when the lookup returns %j", async (found) => {
            const roomService = makeRoomService();
            roomService.listRooms.mockResolvedValue(found);

            await makeService(roomService).createRoom(SHORT_ROOM);

            expect(roomService.createRoom).toHaveBeenCalledTimes(1);
            expect(roomService.createRoom).toHaveBeenCalledWith({ name: SHORT_ROOM });
        });

        it("looks a room over 250 characters up by its plain name but creates it under the hash (current behavior)", async () => {
            const roomService = makeRoomService();

            await makeService(roomService).createRoom(LONG_ROOM);

            expect(roomService.listRooms).toHaveBeenCalledWith([LONG_ROOM]);
            expect(roomService.createRoom).toHaveBeenCalledWith({ name: LONG_ROOM_HASH });
        });

        it("passes a media server failure on to the caller", async () => {
            const roomService = makeRoomService();
            roomService.createRoom.mockRejectedValue(new Error("livekit down"));

            await expect(makeService(roomService).createRoom(SHORT_ROOM)).rejects.toThrow("livekit down");
        });
    });

    describe("deleteRoom", () => {
        it.each([
            [SHORT_ROOM, SHORT_ROOM],
            [LONG_ROOM, LONG_ROOM_HASH],
        ])("deletes the room the media server knows (%#)", async (room, sent) => {
            const roomService = makeRoomService();
            await makeService(roomService).deleteRoom(room);
            expect(roomService.deleteRoom).toHaveBeenCalledWith(sent);
        });

        it("reports a media server failure to Sentry instead of throwing", async () => {
            const roomService = makeRoomService();
            const failure = new Error("livekit down");
            roomService.deleteRoom.mockRejectedValue(failure);

            await expect(makeService(roomService).deleteRoom(SHORT_ROOM)).resolves.toBeUndefined();
            expect(Sentry.captureException).toHaveBeenCalledWith(failure);
        });
    });

    describe("setParticipantCanPublish", () => {
        it("returns false and changes nothing when the person is not in the media room", async () => {
            const roomService = makeRoomService();
            roomService.listParticipants.mockResolvedValue([{ identity: "someone-else" }]);

            const result = await makeService(roomService).setParticipantCanPublish(
                LONG_ROOM,
                "space-user-7",
                "everything"
            );

            expect(result).toBe(false);
            expect(roomService.listParticipants).toHaveBeenCalledWith(LONG_ROOM_HASH);
            expect(roomService.updateParticipant).not.toHaveBeenCalled();
        });

        it.each([
            [
                "everything",
                true,
                [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
            ],
            ["camera", true, [TrackSource.CAMERA]],
            ["microphone", true, [TrackSource.MICROPHONE]],
            ["nothing", false, []],
        ] as [PublishRight, boolean, TrackSource[]][])(
            "updates a person in the room to publish right %s",
            async (right, canPublish, sources) => {
                const roomService = makeRoomService();
                roomService.listParticipants.mockResolvedValue([{ identity: "space-user-7" }]);

                const result = await makeService(roomService).setParticipantCanPublish(
                    LONG_ROOM,
                    "space-user-7",
                    right
                );

                expect(result).toBe(true);
                expect(roomService.updateParticipant).toHaveBeenCalledWith(LONG_ROOM_HASH, "space-user-7", undefined, {
                    canPublish,
                    canSubscribe: true,
                    canPublishSources: sources,
                });
            }
        );

        it("returns false and reports to Sentry when the media server fails", async () => {
            const roomService = makeRoomService();
            const failure = new Error("livekit down");
            roomService.listParticipants.mockResolvedValue([{ identity: "space-user-7" }]);
            roomService.updateParticipant.mockRejectedValue(failure);

            const result = await makeService(roomService).setParticipantCanPublish(
                SHORT_ROOM,
                "space-user-7",
                "nothing"
            );

            expect(result).toBe(false);
            expect(Sentry.captureException).toHaveBeenCalledWith(failure);
        });
    });

    describe("removeParticipant", () => {
        it("removes the person by space user id from the room the media server knows", async () => {
            const roomService = makeRoomService();
            roomService.listRooms.mockResolvedValue([{ name: LONG_ROOM_HASH }]);
            roomService.listParticipants.mockResolvedValue([{ identity: "space-user-7" }]);

            await makeService(roomService).removeParticipant(LONG_ROOM, "space-user-7");

            expect(roomService.listRooms).toHaveBeenCalledWith([LONG_ROOM_HASH]);
            expect(roomService.listParticipants).toHaveBeenCalledWith(LONG_ROOM_HASH);
            expect(roomService.removeParticipant).toHaveBeenCalledWith(LONG_ROOM_HASH, "space-user-7");
        });

        it("does nothing when the room does not exist", async () => {
            const roomService = makeRoomService();
            roomService.listRooms.mockResolvedValue([]);

            await makeService(roomService).removeParticipant(SHORT_ROOM, "space-user-7");

            expect(roomService.listParticipants).not.toHaveBeenCalled();
            expect(roomService.removeParticipant).not.toHaveBeenCalled();
        });

        it("does nothing when the person is not in the room", async () => {
            const roomService = makeRoomService();
            roomService.listRooms.mockResolvedValue([{ name: SHORT_ROOM }]);
            roomService.listParticipants.mockResolvedValue([{ identity: "someone-else" }]);

            await makeService(roomService).removeParticipant(SHORT_ROOM, "space-user-7");

            expect(roomService.removeParticipant).not.toHaveBeenCalled();
        });

        it("reports a media server failure to Sentry instead of throwing", async () => {
            const roomService = makeRoomService();
            const failure = new Error("livekit down");
            roomService.listRooms.mockResolvedValue([{ name: SHORT_ROOM }]);
            roomService.listParticipants.mockResolvedValue([{ identity: "space-user-7" }]);
            roomService.removeParticipant.mockRejectedValue(failure);

            await expect(
                makeService(roomService).removeParticipant(SHORT_ROOM, "space-user-7")
            ).resolves.toBeUndefined();
            expect(Sentry.captureException).toHaveBeenCalledWith(failure);
        });
    });

    describe("getLivekitFrontendUrl", () => {
        it("returns the frontend URL", () => {
            expect(makeService().getLivekitFrontendUrl()).toBe(FRONTEND_URL);
        });

        it("throws when the frontend URL is not set", () => {
            expect(() => makeService(makeRoomService(), makeEgress(), "").getLivekitFrontendUrl()).toThrow(
                "Livekit frontend URL is not set"
            );
        });
    });

    describe("recording", () => {
        it("records the room the media server knows and stops that recording", async () => {
            const egress = makeEgress();
            const service = makeService(makeRoomService(), egress);

            await service.startRecording(LONG_ROOM);
            expect(egress.startRoomCompositeEgress).toHaveBeenCalledWith(LONG_ROOM_HASH, expect.anything(), {
                layout: "grid",
            });

            await service.stopRecording();
            expect(egress.stopEgress).toHaveBeenCalledWith("egress-1");

            await service.stopRecording();
            expect(egress.stopEgress).toHaveBeenCalledTimes(1);
        });

        it("does nothing when asked to stop with no recording", async () => {
            const egress = makeEgress();
            await makeService(makeRoomService(), egress).stopRecording();
            expect(egress.stopEgress).not.toHaveBeenCalled();
        });

        it("reports a failed start to Sentry and throws", async () => {
            const egress = makeEgress();
            const failure = new Error("egress down");
            egress.startRoomCompositeEgress.mockRejectedValue(failure);

            await expect(makeService(makeRoomService(), egress).startRecording(SHORT_ROOM)).rejects.toThrow(
                "Failed to start recording"
            );
            expect(Sentry.captureException).toHaveBeenCalledWith(failure);
        });
    });
});
