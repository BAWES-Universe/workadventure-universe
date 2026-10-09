import { describe, expect, it, assert } from "vitest";
import type { WAMFileFormat } from "../src";
import { UpdateWAMSettingCommand } from "../src";

describe("WAM Setting", () => {
    const defaultWamFile: WAMFileFormat = {
        version: "1.0.0",
        mapUrl: "testMapUrl",
        entities: {},
        areas: [],
        entityCollections: [],
    };
    const dataToModify = {
        enabled: true,
        title: "testTitle",
        rights: ["testRights"],
        scope: "testScope",
    };
    it("should change WAM file loaded when WAMSettingCommand received", async () => {
        const wamFile: WAMFileFormat = { ...defaultWamFile };
        const command = new UpdateWAMSettingCommand(
            wamFile,
            {
                message: {
                    $case: "updateMegaphoneSettingMessage",
                    updateMegaphoneSettingMessage: dataToModify,
                },
            },
            "test-uuid"
        );
        await command.execute();
        expect(wamFile.settings).toBeDefined();
        if (wamFile.settings) {
            expect(wamFile.settings.megaphone).toBeDefined();
            if (wamFile.settings.megaphone) {
                expect(wamFile.settings.megaphone).toEqual(dataToModify);
            } else {
                assert.fail("wamFile.settings.megaphone is not defined");
            }
        } else {
            assert.fail("wamFile.settings is not defined");
        }
        /*expect(result.type).toBe("UpdateWAMSettingCommand");
        if (result.type === "UpdateWAMSettingCommand") {
            expect(result.name).toBe("megaphone");
            expect(result.dataToModify).toEqual(dataToModify);
        } else {
            assert.fail("result.type is not UpdateWAMSettingCommand");
        }*/
    });
});

describe("Megaphone channels", async () => {
    const { WAMSettingsUtils } = await import("../src/WAMSettingsUtils");
    const roomUrl = "https://play.example.com/@/bawes/hq/main-hall";

    it("lists the room and world channels the settings allow, plus the universe channel of an Orbit room", () => {
        const channels = WAMSettingsUtils.getMegaphoneChannels(
            { megaphone: { enabled: true, scopes: ["ROOM", "WORLD"], rights: [] } },
            "bawes/hq",
            roomUrl,
            []
        );
        expect(channels.map((channel) => channel.scope)).toEqual(["ROOM", "WORLD", "UNIVERSE"]);
        expect(channels[0].url).toBe("play.example.com-@-bawes-hq-main-hall-megaphone-room");
        expect(channels[1].url).toBe("bawes-hq-megaphone-world");
        expect(channels[2].url).toBe("bawes-megaphone-universe");
    });

    it("lets everyone go live on the room's channels when no tag is set, but only admins on the universe's", () => {
        const channels = WAMSettingsUtils.getMegaphoneChannels(
            { megaphone: { enabled: true, scopes: ["WORLD", "UNIVERSE"], rights: [] } },
            "bawes/hq",
            roomUrl,
            []
        );
        expect(channels.map((channel) => [channel.scope, channel.canStream])).toEqual([
            ["ROOM", true],
            ["WORLD", true],
            ["UNIVERSE", false],
        ]);
        const admin = WAMSettingsUtils.getMegaphoneChannels(
            { megaphone: { enabled: true, scopes: ["WORLD", "UNIVERSE"], rights: ["staff"] } },
            "bawes/hq",
            roomUrl,
            ["admin"]
        );
        expect(admin.map((channel) => [channel.scope, channel.canStream])).toEqual([
            ["ROOM", false],
            ["WORLD", false],
            ["UNIVERSE", true],
        ]);
    });

    it("keeps the universe channel for listening while its switch is off, so no one may go live on it", () => {
        const admin = WAMSettingsUtils.getMegaphoneChannels(
            { megaphone: { enabled: true, scopes: ["WORLD"], rights: [] } },
            "bawes/hq",
            roomUrl,
            ["admin"]
        );
        expect(admin.map((channel) => [channel.scope, channel.canStream])).toEqual([
            ["ROOM", true],
            ["WORLD", true],
            ["UNIVERSE", false],
        ]);
    });

    it("keeps the single scope of rooms configured before scopes existed, WORLD by default", () => {
        expect(WAMSettingsUtils.getMegaphoneScopes({ megaphone: { enabled: true } })).toEqual(["ROOM", "WORLD"]);
        expect(WAMSettingsUtils.getMegaphoneScopes({ megaphone: { enabled: true, scope: "ROOM" } })).toEqual(["ROOM"]);
        expect(WAMSettingsUtils.getMegaphoneScopes({ megaphone: { enabled: false, scope: "ROOM" } })).toEqual([]);
    });

    it("makes a reach include the narrower ones", () => {
        expect(WAMSettingsUtils.getMegaphoneScopes({ megaphone: { enabled: true, scopes: ["WORLD"] } })).toEqual([
            "ROOM",
            "WORLD",
        ]);
        expect(WAMSettingsUtils.getMegaphoneScopes({ megaphone: { enabled: true, scopes: ["UNIVERSE"] } })).toEqual([
            "ROOM",
            "WORLD",
            "UNIVERSE",
        ]);
    });

    it("lets admins go live everywhere in a room nobody has set up, and no one else", () => {
        expect(WAMSettingsUtils.getMegaphoneScopes({})).toEqual(["ROOM", "WORLD", "UNIVERSE"]);
        expect(WAMSettingsUtils.getMegaphoneScopes(undefined)).toEqual(["ROOM", "WORLD", "UNIVERSE"]);
        const admin = WAMSettingsUtils.getMegaphoneChannels(undefined, "bawes/hq", roomUrl, ["admin"]);
        expect(admin.map((channel) => [channel.scope, channel.canStream])).toEqual([
            ["ROOM", true],
            ["WORLD", true],
            ["UNIVERSE", true],
        ]);
        const member = WAMSettingsUtils.getMegaphoneChannels(undefined, "bawes/hq", roomUrl, ["member"]);
        expect(member.map((channel) => channel.canStream)).toEqual([false, false, false]);
    });

    it("lets the roles chosen go live: admins and editors, or all members", () => {
        const settings = { megaphone: { enabled: true, scopes: ["ROOM", "WORLD"], rights: ["admin", "editor"] } };
        expect(WAMSettingsUtils.hasMegaphoneRights(settings, ["editor"])).toBe(true);
        expect(WAMSettingsUtils.hasMegaphoneRights(settings, ["member"])).toBe(false);
        expect(WAMSettingsUtils.hasMegaphoneRights(settings, [])).toBe(false);
    });

    it("makes the host the world without a group, and has no universe channel without an Orbit group", () => {
        const channels = WAMSettingsUtils.getMegaphoneChannels(
            { megaphone: { enabled: true, scopes: ["ROOM", "WORLD"] } },
            null,
            roomUrl,
            ["admin"]
        );
        expect(channels.map((channel) => channel.scope)).toEqual(["ROOM", "WORLD"]);
        expect(channels[1].url).toBe("play.example.com-megaphone-world");
        expect(
            WAMSettingsUtils.getMegaphoneChannels(
                { megaphone: { enabled: true, scopes: ["WORLD"] } },
                "play.example.com",
                roomUrl,
                ["admin"]
            ).map((channel) => channel.scope)
        ).toEqual(["ROOM", "WORLD"]);
    });
});
