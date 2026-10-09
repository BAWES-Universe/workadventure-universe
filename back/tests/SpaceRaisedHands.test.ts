import { describe, expect, it, vi } from "vitest";
import type { BackToPusherSpaceMessage } from "@workadventure/messages";
import { FilterType, SpaceUser } from "@workadventure/messages";
import { mock } from "vitest-mock-extended";
import { Space } from "../src/Model/Space";
import type { SpacesWatcher } from "../src/Model/SpacesWatcher";
import type { EventProcessor } from "../src/Model/EventProcessor";

type SpaceInternals = {
    users: Map<SpacesWatcher, Map<string, SpaceUser>>;
    communicationManager: {
        handleUserAdded: (user: SpaceUser) => Promise<void>;
        handleUserDeleted: (user: SpaceUser) => Promise<void>;
        handleUserUpdated: (user: SpaceUser) => Promise<void>;
    };
};

function setup(listener: SpaceUser) {
    const space = new Space("podium", FilterType.LIVE_STREAMING_USERS, mock<EventProcessor>(), [], "world");
    const internals = space as unknown as SpaceInternals;
    const write = vi.fn();
    const watcher = mock<SpacesWatcher>({ id: "watcher", write });
    internals.users.set(watcher, new Map([[listener.spaceUserId, listener]]));
    const handleUserAdded = vi.fn().mockResolvedValue(undefined);
    const handleUserDeleted = vi.fn().mockResolvedValue(undefined);
    const handleUserUpdated = vi.fn().mockResolvedValue(undefined);
    internals.communicationManager = { handleUserAdded, handleUserDeleted, handleUserUpdated };
    return { space, watcher, write, handleUserAdded, handleUserDeleted, handleUserUpdated };
}

const messageCases = (write: ReturnType<typeof vi.fn>) =>
    write.mock.calls.map(([message]) => (message as { message: { $case: string } }).message.$case);

describe("Space: raised hands in the audience of a live stream", () => {
    it("lists a listener who raises a hand, without connecting them for media", () => {
        const listener = SpaceUser.fromPartial({ spaceUserId: "listener_1", uuid: "uuid-1", megaphoneState: false });
        const { space, watcher, write, handleUserAdded } = setup(listener);

        space.updateUser(watcher, { ...listener, handRaisedAt: 1000 }, ["handRaisedAt"]);

        expect(messageCases(write)).toEqual(["addSpaceUserMessage"]);
        expect(handleUserAdded).not.toHaveBeenCalled();
    });

    it("unlists them when the hand goes down", () => {
        const listener = SpaceUser.fromPartial({
            spaceUserId: "listener_1",
            uuid: "uuid-1",
            megaphoneState: false,
            handRaisedAt: 1000,
        });
        const { space, watcher, write, handleUserDeleted } = setup(listener);

        space.updateUser(watcher, { ...listener, handRaisedAt: 0 }, ["handRaisedAt"]);

        expect(messageCases(write)).toEqual(["removeSpaceUserMessage"]);
        expect(handleUserDeleted).not.toHaveBeenCalled();
    });

    it("connects them when they start streaming with the hand still up, and keeps them listed", () => {
        const listener = SpaceUser.fromPartial({
            spaceUserId: "listener_1",
            uuid: "uuid-1",
            megaphoneState: false,
            handRaisedAt: 1000,
        });
        const { space, watcher, write, handleUserAdded } = setup(listener);

        space.updateUser(watcher, { ...listener, megaphoneState: true }, ["megaphoneState"]);

        expect(messageCases(write)).toEqual(["updateSpaceUserMessage"]);
        expect(handleUserAdded).toHaveBeenCalledTimes(1);
    });

    it("disconnects someone who stops streaming but keeps a hand up, and keeps them listed", () => {
        const speaker = SpaceUser.fromPartial({
            spaceUserId: "speaker_1",
            uuid: "uuid-1",
            megaphoneState: true,
            handRaisedAt: 1000,
        });
        const { space, watcher, write, handleUserDeleted } = setup(speaker);

        space.updateUser(watcher, { ...speaker, megaphoneState: false }, ["megaphoneState"]);

        expect(messageCases(write)).toEqual(["updateSpaceUserMessage"]);
        expect(handleUserDeleted).toHaveBeenCalledTimes(1);
    });

    it("sends listed raised hands to a new watcher", () => {
        const listener = SpaceUser.fromPartial({
            spaceUserId: "listener_1",
            uuid: "uuid-1",
            megaphoneState: false,
            handRaisedAt: 1000,
        });
        const { space } = setup(listener);
        const write = vi.fn();

        space.addWatcher(mock<SpacesWatcher>({ id: "watcher-2", write }));

        const init = write.mock.calls
            .map(([message]) => (message as BackToPusherSpaceMessage).message)
            .find((message) => message?.$case === "initSpaceUsersMessage");
        expect(
            init?.$case === "initSpaceUsersMessage" && init.initSpaceUsersMessage.users.map((user) => user.spaceUserId)
        ).toEqual(["listener_1"]);
    });

    it("tells the watchers when a listed listener leaves, without touching media", () => {
        const listener = SpaceUser.fromPartial({
            spaceUserId: "listener_1",
            uuid: "uuid-1",
            megaphoneState: false,
            handRaisedAt: 1000,
        });
        const { space, watcher, write, handleUserDeleted } = setup(listener);

        space.removeUser(watcher, "listener_1");

        expect(messageCases(write)).toEqual(["removeSpaceUserMessage"]);
        expect(handleUserDeleted).not.toHaveBeenCalled();
    });
});
