import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BubbleSpaceGrants } from "../../src/pusher/services/BubbleSpaceGrants";

const BUBBLE = "http://play.example.com/@/team/world/room#12#1700000000000";
const FULL_NAME = `my-world.${BUBBLE}`;

interface FakeSocket {
    data: {
        world: string;
        disconnecting: boolean;
        spaces: Set<string>;
        joinSpacesPromise: Map<string, Promise<void>>;
        grantedBubbleSpaces: Set<string>;
    };
}

function makeSocket(): FakeSocket {
    return {
        data: {
            world: "my-world",
            disconnecting: false,
            spaces: new Set(),
            joinSpacesPromise: new Map(),
            grantedBubbleSpaces: new Set(),
        },
    };
}

describe("BubbleSpaceGrants", () => {
    let leaveSpace: ReturnType<typeof vi.fn<(socket: FakeSocket, spaceName: string) => Promise<void>>>;
    let grants: BubbleSpaceGrants<FakeSocket>;

    beforeEach(() => {
        vi.useFakeTimers();
        leaveSpace = vi.fn<(socket: FakeSocket, spaceName: string) => Promise<void>>(() => Promise.resolve());
        grants = new BubbleSpaceGrants<FakeSocket>({
            getSocketData: (socket) => socket.data,
            leaveSpace,
            graceMs: 5000,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("records the bubble the back asked to join, and forgets it on leave", () => {
        const socket = makeSocket();
        grants.grant(socket, BUBBLE);
        expect(socket.data.grantedBubbleSpaces.has(BUBBLE)).toBe(true);

        grants.revoke(socket, BUBBLE);
        expect(socket.data.grantedBubbleSpaces.has(BUBBLE)).toBe(false);
    });

    it("makes a player that stays in the bubble leave after the grace delay", () => {
        const socket = makeSocket();
        grants.grant(socket, BUBBLE);
        socket.data.spaces.add(FULL_NAME);

        grants.revoke(socket, BUBBLE);
        vi.advanceTimersByTime(4999);
        expect(leaveSpace).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(leaveSpace).toHaveBeenCalledWith(socket, FULL_NAME);
    });

    it("does nothing when the player left by itself", () => {
        const socket = makeSocket();
        grants.grant(socket, BUBBLE);
        socket.data.spaces.add(FULL_NAME);

        grants.revoke(socket, BUBBLE);
        socket.data.spaces.delete(FULL_NAME);
        vi.advanceTimersByTime(5000);
        expect(leaveSpace).not.toHaveBeenCalled();
    });

    it("keeps a player the back asked back into the same bubble", () => {
        const socket = makeSocket();
        grants.grant(socket, BUBBLE);
        socket.data.spaces.add(FULL_NAME);

        grants.revoke(socket, BUBBLE);
        vi.advanceTimersByTime(2000);
        grants.grant(socket, BUBBLE);
        vi.advanceTimersByTime(10000);
        expect(leaveSpace).not.toHaveBeenCalled();
    });

    it("waits the full delay again after a second leave request", () => {
        const socket = makeSocket();
        grants.grant(socket, BUBBLE);
        socket.data.spaces.add(FULL_NAME);

        grants.revoke(socket, BUBBLE);
        vi.advanceTimersByTime(4000);
        grants.grant(socket, BUBBLE);
        grants.revoke(socket, BUBBLE);
        vi.advanceTimersByTime(4000);
        expect(leaveSpace).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1000);
        expect(leaveSpace).toHaveBeenCalledTimes(1);
    });

    it("leaves a socket that is closing to the normal cleanup", () => {
        const socket = makeSocket();
        grants.grant(socket, BUBBLE);
        socket.data.spaces.add(FULL_NAME);

        grants.revoke(socket, BUBBLE);
        socket.data.disconnecting = true;
        vi.advanceTimersByTime(5000);
        expect(leaveSpace).not.toHaveBeenCalled();
    });
});
