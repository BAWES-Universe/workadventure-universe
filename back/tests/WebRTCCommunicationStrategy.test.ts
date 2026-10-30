import { describe, expect, it } from "vitest";
import { SpaceUser } from "@workadventure/messages";
import { WebRTCCommunicationStrategy } from "../src/Model/Strategies/WebRTCCommunicationStrategy";
import type { ICommunicationSpace } from "../src/Model/Interfaces/ICommunicationSpace";

const person = (id: string): SpaceUser => SpaceUser.fromPartial({ spaceUserId: id, uuid: `uuid-${id}`, name: id });
const botByUuid = (id: string): SpaceUser => SpaceUser.fromPartial({ spaceUserId: id, uuid: `bot-${id}`, name: id });
const botByTag = (id: string): SpaceUser =>
    SpaceUser.fromPartial({ spaceUserId: id, uuid: `uuid-${id}`, name: id, tags: ["bot"] });

const asMap = (...users: SpaceUser[]): Map<string, SpaceUser> => new Map(users.map((u) => [u.spaceUserId, u]));

function makeFixture(users: Map<string, SpaceUser>, usersToNotify: Map<string, SpaceUser>) {
    /** Every WebRTC start the space sent, as "receiver<-sender". */
    const starts: string[] = [];
    const space: ICommunicationSpace = {
        getAllUsers: () => [],
        getUsersInFilter: () => [],
        getUsersToNotify: () => [],
        dispatchPrivateEvent: (event) => {
            if (event.spaceEvent?.event?.$case === "webRtcStartMessage") {
                starts.push(`${event.receiverUserId}<-${event.senderUserId}`);
            }
        },
        dispatchPublicEvent: () => {},
        getSpaceName: () => "room",
        getPropertiesToSync: () => [],
    };
    const strategy = new WebRTCCommunicationStrategy(space, users, usersToNotify);
    return { strategy, starts };
}

describe("WebRTCCommunicationStrategy bots", () => {
    // initialize() runs whenever the bubble enters peer-to-peer, e.g. coming back from LiveKit.
    it("initialize does not start a connection with a bot found by uuid", () => {
        const users = asMap(person("alice"), botByUuid("helper"));
        const { strategy, starts } = makeFixture(users, users);

        strategy.initialize(users, users);

        expect(starts).toEqual([]);
    });

    it("initialize does not start a connection with a bot found by tag", () => {
        const users = asMap(person("alice"), botByTag("helper"));
        const { strategy, starts } = makeFixture(users, users);

        strategy.initialize(users, users);

        expect(starts).toEqual([]);
    });

    it("initialize still connects people to each other when a bot is in the bubble", () => {
        const users = asMap(person("alice"), person("bob"), botByUuid("helper"));
        const { strategy, starts } = makeFixture(users, users);

        strategy.initialize(users, users);

        expect(starts.some((s) => s.includes("helper"))).toBe(false);
        expect(starts).toContain("alice<-bob");
        expect(starts).toContain("bob<-alice");
    });

    it("addUser and addUserToNotify skip bots too", async () => {
        const users = asMap(person("alice"), botByTag("helper"));
        const { strategy, starts } = makeFixture(users, users);

        await strategy.addUser(botByTag("helper"));
        await strategy.addUserToNotify(person("alice"));

        expect(starts).toEqual([]);
    });
});
