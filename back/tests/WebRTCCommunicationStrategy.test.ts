import { describe, expect, it } from "vitest";
import { SpaceUser } from "@workadventure/messages";
import { VOICE_BOT_TAG, WebRTCCommunicationStrategy } from "../src/Model/Strategies/WebRTCCommunicationStrategy";
import type { ICommunicationSpace } from "../src/Model/Interfaces/ICommunicationSpace";

const person = (id: string): SpaceUser => SpaceUser.fromPartial({ spaceUserId: id, uuid: `uuid-${id}`, name: id });
const botByUuid = (id: string): SpaceUser => SpaceUser.fromPartial({ spaceUserId: id, uuid: `bot-${id}`, name: id });
const botByTag = (id: string): SpaceUser =>
    SpaceUser.fromPartial({ spaceUserId: id, uuid: `uuid-${id}`, name: id, tags: ["bot"] });

const voiceBot = (id: string): SpaceUser =>
    SpaceUser.fromPartial({ spaceUserId: id, uuid: `bot-${id}`, name: id, tags: ["bot", VOICE_BOT_TAG] });

const asMap = (...users: SpaceUser[]): Map<string, SpaceUser> => new Map(users.map((u) => [u.spaceUserId, u]));

function makeFixture(users: Map<string, SpaceUser>, usersToNotify: Map<string, SpaceUser>) {
    /** Every WebRTC start the space sent, as "receiver<-sender". */
    const starts: string[] = [];
    /** The people told to make the offer. */
    const initiators: string[] = [];
    /** Every WebRTC disconnect the space sent, as "receiver<-sender". */
    const disconnects: string[] = [];
    const space: ICommunicationSpace = {
        getAllUsers: () => [],
        getUsersInFilter: () => [],
        getUsersToNotify: () => [],
        dispatchPrivateEvent: (event) => {
            if (event.spaceEvent?.event?.$case === "webRtcDisconnectMessage") {
                disconnects.push(`${event.receiverUserId}<-${event.senderUserId}`);
            }
            if (event.spaceEvent?.event?.$case === "webRtcStartMessage") {
                starts.push(`${event.receiverUserId}<-${event.senderUserId}`);
                if (event.spaceEvent.event.webRtcStartMessage.initiator) {
                    initiators.push(event.receiverUserId);
                }
            }
        },
        dispatchPublicEvent: () => {},
        getSpaceName: () => "room",
        getPropertiesToSync: () => [],
    };
    const strategy = new WebRTCCommunicationStrategy(space, users, usersToNotify);
    return { strategy, starts, initiators, disconnects };
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

describe("WebRTCCommunicationStrategy voice bots", () => {
    it.each([
        ["initialize", (s: WebRTCCommunicationStrategy, users: Map<string, SpaceUser>) => s.initialize(users, users)],
        ["addUser", (s: WebRTCCommunicationStrategy) => s.addUser(voiceBot("echo"))],
        ["addUserToNotify", (s: WebRTCCommunicationStrategy) => s.addUserToNotify(person("alice"))],
    ])("connects a voice bot with a person on the %s path, the person making the offer", async (_name, open) => {
        const users = asMap(person("alice"), voiceBot("echo"));
        const { strategy, starts, initiators } = makeFixture(users, users);

        await Promise.resolve(open(strategy, users));

        expect(starts).toContain("alice<-echo");
        expect(starts).toContain("echo<-alice");
        expect(initiators).toEqual(["alice"]);
    });

    it("ends the bot's connection when the bubble leaves peer-to-peer, and opens it again when it comes back", () => {
        const users = asMap(person("alice"), voiceBot("echo"));
        const { strategy, starts, disconnects } = makeFixture(users, users);

        strategy.initialize(users, users);
        strategy.cleanup();
        // Moved to LiveKit: both sides are told to drop the peer-to-peer connection
        expect(disconnects).toContain("alice<-echo");
        expect(disconnects).toContain("echo<-alice");

        // Back in peer-to-peer: a new connection, with the person offering again
        strategy.initialize(users, users);
        expect(starts.filter((s) => s === "echo<-alice")).toHaveLength(2);
    });

    it("makes the person the one who offers whichever of them joined last", async () => {
        const users = asMap(voiceBot("echo"), person("alice"));
        const { strategy, initiators } = makeFixture(users, users);

        await strategy.addUser(person("alice"));

        expect(initiators).toEqual(["alice"]);
    });

    it("keeps a text-only bot out while a voice bot in the same bubble is connected", () => {
        const users = asMap(person("alice"), voiceBot("echo"), botByTag("helper"));
        const { strategy, starts } = makeFixture(users, users);

        strategy.initialize(users, users);

        expect(starts.some((s) => s.includes("helper"))).toBe(false);
        expect(starts).toContain("alice<-echo");
    });

    it("never connects two bots, voice or not", () => {
        const users = asMap(voiceBot("echo"), voiceBot("echo2"), botByTag("helper"));
        const { strategy, starts } = makeFixture(users, users);

        strategy.initialize(users, users);

        expect(starts).toEqual([]);
    });

    it("does not trust the voice tag on someone who is not a bot", () => {
        const sneaky = SpaceUser.fromPartial({ spaceUserId: "mallory", uuid: "uuid-mallory", tags: [VOICE_BOT_TAG] });
        const users = asMap(person("alice"), sneaky);
        const { strategy, starts } = makeFixture(users, users);

        strategy.initialize(users, users);

        // Two people: the usual connection, and no bot rules involved
        expect(starts).toContain("alice<-mallory");
        expect(starts).toContain("mallory<-alice");
    });

    it("does not start a second connection with a voice bot that already has one", () => {
        const users = asMap(person("alice"), voiceBot("echo"));
        const { strategy, starts } = makeFixture(users, users);

        strategy.initialize(users, users);
        strategy.initialize(users, users);

        expect(starts.filter((s) => s === "echo<-alice")).toHaveLength(1);
    });
});
