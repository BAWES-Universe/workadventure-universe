import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceUser } from "@workadventure/messages";
import type { EgressClient, RoomServiceClient } from "livekit-server-sdk";
import { TokenVerifier } from "livekit-server-sdk";
import { LiveKitService } from "../src/Model/Services/LivekitService";
import { LivekitCommunicationStrategy } from "../src/Model/Strategies/LivekitCommunicationStrategy";
import type { ICommunicationSpace } from "../src/Model/Interfaces/ICommunicationSpace";

const API_KEY = "key";
const API_SECRET = "secret-secret-secret-secret-secret-1234";

const user = (id: string, name: string): SpaceUser =>
    SpaceUser.fromPartial({ spaceUserId: id, uuid: `uuid-${id}`, name });

interface Fixture {
    strategy: LivekitCommunicationStrategy;
    roomService: {
        listRooms: ReturnType<typeof vi.fn>;
        createRoom: ReturnType<typeof vi.fn>;
        deleteRoom: ReturnType<typeof vi.fn>;
        listParticipants: ReturnType<typeof vi.fn>;
        removeParticipant: ReturnType<typeof vi.fn>;
        updateParticipant: ReturnType<typeof vi.fn>;
    };
    /** The invitations the space sent, with the token inside each. */
    invitations: { receiver: string; token: string }[];
}

async function decode(token: string) {
    const claims = await new TokenVerifier(API_KEY, API_SECRET).verify(token);
    return { identity: claims.sub as string, video: claims.video };
}

function makeFixture(participants: string[] = []): Fixture {
    const roomService = {
        listRooms: vi.fn().mockResolvedValue([{ name: "room" }]),
        createRoom: vi.fn().mockResolvedValue(undefined),
        deleteRoom: vi.fn().mockResolvedValue(undefined),
        listParticipants: vi
            .fn()
            .mockImplementation(() => Promise.resolve(participants.map((identity) => ({ identity })))),
        removeParticipant: vi.fn().mockResolvedValue(undefined),
        updateParticipant: vi.fn().mockResolvedValue(undefined),
    };
    const invitations: { receiver: string; token: string }[] = [];
    const space: ICommunicationSpace = {
        getAllUsers: () => [],
        getUsersInFilter: () => [],
        getUsersToNotify: () => [],
        dispatchPrivateEvent: (event) => {
            const inner = event.spaceEvent?.event;
            if (inner?.$case === "livekitInvitationMessage") {
                invitations.push({ receiver: event.receiverUserId, token: inner.livekitInvitationMessage.token });
            }
        },
        dispatchPublicEvent: () => {},
        getSpaceName: () => "room",
        getPropertiesToSync: () => [],
    };
    const service = new LiveKitService(
        "http://livekit",
        API_KEY,
        API_SECRET,
        "ws://livekit",
        () => roomService as unknown as RoomServiceClient,
        () => ({} as unknown as EgressClient)
    );
    const strategy = new LivekitCommunicationStrategy(space, service);
    return { strategy, roomService, invitations };
}

async function grants(fixture: Fixture, receiver: string) {
    const entry = fixture.invitations.find((candidate) => candidate.receiver === receiver);
    if (!entry) throw new Error(`no token sent to ${receiver}`);
    const decoded = await decode(entry.token);
    return {
        identity: decoded.identity,
        canPublish: decoded.video?.canPublish,
        sources: decoded.video?.canPublishSources,
    };
}

const flush = async () => {
    await new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
};

describe("LivekitCommunicationStrategy media permissions", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("gives the speaker a sending token and a listener a receive-only one, both under their space user id", async () => {
        const fixture = makeFixture();
        const speaker = user("room_1", "Same Name");
        const listener = user("room_2", "Same Name");

        await fixture.strategy.addUser(speaker);
        await fixture.strategy.addUserToNotify(listener);
        await flush();

        const speakerGrant = await grants(fixture, "room_1");
        expect(speakerGrant.identity).toBe("room_1");
        expect(speakerGrant.canPublish).toBe(true);
        expect(speakerGrant.sources?.length).toBeGreaterThan(0);

        const listenerGrant = await grants(fixture, "room_2");
        expect(listenerGrant.identity).toBe("room_2");
        expect(listenerGrant.canPublish).toBe(false);
        expect(listenerGrant.sources ?? []).toHaveLength(0);
    });

    it("lets a listener send once they stream, and stops them again when they stop", async () => {
        const fixture = makeFixture(["room_2"]);
        const speaker = user("room_1", "A");
        const listener = user("room_2", "B");
        await fixture.strategy.addUser(speaker);
        await fixture.strategy.addUserToNotify(listener);
        await flush();

        await fixture.strategy.addUser(listener);
        await flush();
        expect(fixture.roomService.updateParticipant).toHaveBeenLastCalledWith(
            "room",
            "room_2",
            undefined,
            expect.objectContaining({ canPublish: true })
        );

        fixture.strategy.deleteUser(listener);
        await flush();
        expect(fixture.roomService.updateParticipant).toHaveBeenLastCalledWith(
            "room",
            "room_2",
            undefined,
            expect.objectContaining({ canPublish: false, canPublishSources: [] })
        );
        // Still listening: not removed from the media room
        expect(fixture.roomService.removeParticipant).not.toHaveBeenCalled();
    });

    it("tries again while the person has not reached the media room yet", async () => {
        const participants: string[] = [];
        const fixture = makeFixture(participants);
        const speaker = user("room_1", "A");
        const listener = user("room_2", "B");
        await fixture.strategy.addUser(speaker);
        await fixture.strategy.addUserToNotify(listener);
        await flush();

        await fixture.strategy.addUser(listener);
        await flush();
        expect(fixture.roomService.updateParticipant).not.toHaveBeenCalled();

        participants.push("room_2");
        await vi.advanceTimersByTimeAsync(1100);
        expect(fixture.roomService.updateParticipant).toHaveBeenCalledWith(
            "room",
            "room_2",
            undefined,
            expect.objectContaining({ canPublish: true })
        );
    });

    it("removes a listener from the media room by space user id, not by display name", async () => {
        const fixture = makeFixture(["room_1", "room_2"]);
        const speaker = user("room_1", "Alex");
        const listener = user("room_2", "Alex");
        await fixture.strategy.addUser(speaker);
        await fixture.strategy.addUserToNotify(listener);
        await flush();

        fixture.strategy.deleteUserFromNotify(listener);
        await flush();

        expect(fixture.roomService.removeParticipant).toHaveBeenCalledTimes(1);
        expect(fixture.roomService.removeParticipant).toHaveBeenCalledWith("room", "room_2");
    });
});
