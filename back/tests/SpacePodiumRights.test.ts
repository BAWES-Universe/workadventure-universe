import { describe, expect, it, vi } from "vitest";
import type { PrivateEvent } from "@workadventure/messages";
import { FilterType, SpaceUser } from "@workadventure/messages";
import { mock } from "vitest-mock-extended";
import { Space } from "../src/Model/Space";
import type { SpacesWatcher } from "../src/Model/SpacesWatcher";
import { EventProcessor } from "../src/Model/EventProcessor";

type SpaceInternals = {
    users: Map<SpacesWatcher, Map<string, SpaceUser>>;
    communicationManager: Record<string, () => Promise<void>>;
};

const person = (spaceUserId: string, extra: Partial<SpaceUser> = {}) =>
    SpaceUser.fromPartial({ spaceUserId, uuid: `uuid-${spaceUserId}`, name: spaceUserId, tags: [], ...extra });

function setup(people: SpaceUser[]) {
    const space = new Space("podium", FilterType.LIVE_STREAMING_USERS, new EventProcessor(), [], "world");
    const internals = space as unknown as SpaceInternals;
    const write = vi.fn();
    const watcher = mock<SpacesWatcher>({ id: "watcher", write });
    internals.users.set(watcher, new Map(people.map((p) => [p.spaceUserId, p])));
    const resolved = vi.fn().mockResolvedValue(undefined);
    internals.communicationManager = {
        handleUserAdded: resolved,
        handleUserDeleted: resolved,
        handleUserUpdated: resolved,
    };
    const state = (id: string) => internals.users.get(watcher)?.get(id);
    const send = (
        senderUserId: string,
        receiverUserId: string,
        event: NonNullable<PrivateEvent["spaceEvent"]>["event"]
    ) =>
        space.dispatchPrivateEvent({
            spaceName: "podium",
            senderUserId,
            receiverUserId,
            spaceEvent: { event },
        } as PrivateEvent);
    const invite = (from: string, to: string) => send(from, to, { $case: "inviteToSpeak", inviteToSpeak: {} });
    const moveBack = (from: string, to: string) => send(from, to, { $case: "moveToAudience", moveToAudience: {} });
    const decline = (from: string, to: string) => send(from, to, { $case: "declineToSpeak", declineToSpeak: {} });
    const goLive = (id: string) =>
        space.updateUser(watcher, { ...state(id)!, megaphoneState: true }, ["megaphoneState"]);
    const stop = (id: string) =>
        space.updateUser(watcher, { ...state(id)!, megaphoneState: false }, ["megaphoneState"]);
    return { space, watcher, state, invite, moveBack, decline, goLive, stop };
}

const host = () => person("host", { megaphoneState: true });
const guest = () => person("guest");
const outsider = () => person("outsider");

describe("Space: who runs a podium", () => {
    it("lets a speaker invite someone and send them back; the invited person speaks as a guest", () => {
        const { invite, goLive, moveBack, state } = setup([host(), guest()]);

        invite("host", "guest");
        goLive("guest");
        expect(state("guest")?.megaphoneState).toBe(true);

        moveBack("host", "guest");
        expect(state("guest")?.megaphoneState).toBe(false);
    });

    it("lets an admin invite and send back without speaking", () => {
        const { invite, goLive, moveBack, state } = setup([person("admin", { tags: ["admin"] }), guest()]);

        invite("admin", "guest");
        goLive("guest");
        moveBack("admin", "guest");

        expect(state("guest")?.megaphoneState).toBe(false);
    });

    it("refuses an invitation or a move from someone in the audience, even if their browser says otherwise", () => {
        const { invite, moveBack, state } = setup([host(), guest(), outsider()]);

        expect(() => invite("outsider", "guest")).toThrow("Only speakers and admins can invite someone to speak");
        expect(() => moveBack("outsider", "host")).toThrow("Only speakers and admins can move someone to the audience");
        expect(state("host")?.megaphoneState).toBe(true);
    });

    it("does not make a guest a host: a guest cannot invite others or send anybody back", () => {
        const { invite, moveBack, goLive, state } = setup([host(), guest(), outsider()]);

        invite("host", "guest");
        goLive("guest");

        expect(() => invite("guest", "outsider")).toThrow("Only speakers and admins can invite someone to speak");
        expect(() => moveBack("guest", "host")).toThrow("Only speakers and admins can move someone to the audience");
        expect(state("host")?.megaphoneState).toBe(true);
    });

    it("keeps someone sent back off the stage until they are invited again", () => {
        const { invite, moveBack, goLive, state } = setup([host(), guest()]);

        invite("host", "guest");
        goLive("guest");
        moveBack("host", "guest");
        goLive("guest");
        expect(state("guest")?.megaphoneState).toBe(false);

        invite("host", "guest");
        goLive("guest");
        expect(state("guest")?.megaphoneState).toBe(true);
    });

    it("forgets an invitation that was declined: speaking later is not as a guest", () => {
        const { invite, decline, goLive, state } = setup([host(), guest(), outsider()]);

        invite("host", "guest");
        decline("guest", "host");
        goLive("guest");

        // Nothing makes them a guest. Whether they may speak at all is up to the rights of the area (checked in the
        // pusher); in an open stage they are an ordinary speaker, as before.
        expect(state("guest")?.megaphoneState).toBe(true);
        expect(() => invite("guest", "outsider")).not.toThrow();
    });

    it("does not silence a speaker who was never brought on stage when someone sends them back", () => {
        const { moveBack, state } = setup([host(), person("other", { megaphoneState: true })]);

        moveBack("host", "other");

        expect(state("other")?.megaphoneState).toBe(true);
    });

    it("spends an invitation once: speaking again later is not as a guest", () => {
        const { invite, goLive, stop, state } = setup([host(), guest(), outsider()]);

        invite("host", "guest");
        goLive("guest");
        expect(() => invite("guest", "outsider")).toThrow();
        stop("guest");
        goLive("guest");

        expect(state("guest")?.megaphoneState).toBe(true);
        expect(() => invite("guest", "outsider")).not.toThrow();
    });
});
