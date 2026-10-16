import { describe, expect, it, vi } from "vitest";
import { FilterType } from "@workadventure/messages";

// The pusher's environment is checked when its enums are imported
vi.hoisted(() => {
    process.env.SECRET_KEY ??= "test-secret";
    process.env.API_URL ??= "localhost:50051";
});

import { checkSpaceJoin, SpaceJoinRefusedError } from "../../src/pusher/services/SpaceJoinPolicy";
import { setMegaphoneSettings } from "../../src/pusher/models/MegaphoneRights";
import type { SocketData } from "../../src/pusher/models/Websocket/SocketData";

type Rights = Pick<SocketData, "grantedBubbleSpaces" | "megaphoneChannels" | "refusedAreaSpaces">;

function player(): Rights {
    return { grantedBubbleSpaces: new Set(), megaphoneChannels: undefined, refusedAreaSpaces: undefined };
}

const join = (name: string, socketData: Rights) =>
    checkSpaceJoin({ localSpaceName: name, filterType: FilterType.ALL_USERS, propertiesToSync: [] }, socketData);

describe("joining the meeting room of an area limited to other roles", () => {
    it("is refused for the names the back listed, and only those", () => {
        const socketData = player();
        setMegaphoneSettings(socketData, { enabled: false, refusedAreaSpaces: ["area__ab12-board"] });
        expect(() => join("area__ab12-board", socketData)).toThrow(SpaceJoinRefusedError);
        expect(() => join("area__ab12-cafe", socketData)).not.toThrow();
        expect(() => join("some-script-space", socketData)).not.toThrow();
    });

    it("is refused whether the front joins under the name or the slugified name", () => {
        const socketData = player();
        setMegaphoneSettings(socketData, { enabled: false, refusedAreaSpaces: ["area__ab12-Board Room"] });
        expect(() => join("area__ab12-Board Room", socketData)).toThrow(SpaceJoinRefusedError);
        expect(() => join("area__ab12-board-room", socketData)).toThrow(SpaceJoinRefusedError);
    });

    it("is allowed again when the back sends a shorter list after the rule changed", () => {
        const socketData = player();
        setMegaphoneSettings(socketData, { enabled: false, refusedAreaSpaces: ["area__ab12-board"] });
        expect(() => join("area__ab12-board", socketData)).toThrow(SpaceJoinRefusedError);
        setMegaphoneSettings(socketData, { enabled: false, refusedAreaSpaces: [] });
        expect(() => join("area__ab12-board", socketData)).not.toThrow();
    });

    it("is not checked before the back has said anything (open rooms, older back)", () => {
        expect(() => join("area__ab12-board", player())).not.toThrow();
    });

    it("keeps working with the broadcast settings the back sent before", () => {
        const socketData = player();
        setMegaphoneSettings(socketData, { enabled: true, url: "lobby-megaphone-room" });
        expect(socketData.megaphoneChannels?.get("lobby-megaphone-room")).toBe(true);
        expect(socketData.refusedAreaSpaces?.size).toBe(0);
    });
});
