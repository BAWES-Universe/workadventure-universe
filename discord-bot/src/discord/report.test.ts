import { test } from "node:test";
import * as assert from "node:assert/strict";
import { buildReport, buildUniversePosts, escapeMarkdown, groupUniverses, namesLine, peopleAndBots } from "./report";
import type { ReportIcons, ReportUniverse } from "./report";
import type { RoomDetailsMap, RoomMetadata } from "../types";

const NOW = new Date("2026-10-25T10:35:00Z");
const ICONS: ReportIcons = {
    universe: { id: "1", name: "universe_planet" },
    world: { id: "2", name: "universe_world" },
    room: { id: "3", name: "universe_room" },
    people: { id: "4", name: "universe_people" },
    clock: { id: "5", name: "universe_clock" },
};
const url = (path: string) => `https://play.test/@/${path}`;

// The mock's example: BAWES Universe (Headquarters 6 people, 21 bots) and Acme Universe (Design Lab 2 + 1 bot,
// Lobby 1), plus a room with only bots and an empty room, which are left off.
const ROOMS: RoomDetailsMap = {
    [url("acme/main/lobby")]: { people: 1, bots: 0, names: ["Omar"] },
    [url("bawes/world/hq")]: {
        people: 6,
        bots: 21,
        names: ["Khalid", "AH(Melon)", "Ahmad", "fawaz", "Mishari", "Yousef"],
    },
    [url("acme/studio/lab")]: { people: 2, bots: 1, names: ["Sara", "Noor"] },
    [url("bawes/world/bots-only")]: { people: 0, bots: 4, names: [] },
    [url("bawes/world/empty")]: { people: 0, bots: 0, names: [] },
};
const METADATA = new Map<string, RoomMetadata>([
    ["acme/main/lobby", { universeName: "Acme Universe", worldName: "Main World", roomName: "Lobby", universeColour: "#d946ef" }],
    ["acme/studio/lab", { universeName: "Acme Universe", worldName: "Studio World", roomName: "Design Lab", universeColour: "#d946ef" }],
    ["bawes/world/hq", { universeName: "BAWES Universe", worldName: "BAWES World", roomName: "Headquarters", universeColour: "#8b5cf6" }],
]);

test("counts say person or people and bot or bots, and leave out zero bots", () => {
    assert.equal(peopleAndBots(6, 21), "**6 people** · 21 bots");
    assert.equal(peopleAndBots(1, 1), "**1 person** · 1 bot");
    assert.equal(peopleAndBots(2, 0), "**2 people**");
});

test("the summary counts people, bots, active rooms and universes, with Last updated", () => {
    const { summary } = buildReport(ROOMS, METADATA, ICONS, NOW);
    const embed = summary.embeds![0];
    assert.equal(embed.title, "Universe right now");
    assert.deepEqual(embed.fields, [
        { name: "<:universe_people:4> People online", value: "**9** · 22 bots", inline: true },
        { name: "<:universe_room:3> Active rooms", value: "**3** in 2 universes", inline: true },
        { name: "<:universe_clock:5> Last updated", value: `<t:${NOW.getTime() / 1000}:R>`, inline: true },
    ]);
    assert.equal(summary.components, undefined);
});

test("one post per universe, most people first, rooms most people first, bots never change the order", () => {
    const universes = groupUniverses(ROOMS, METADATA);
    assert.deepEqual(
        universes.map((universe) => [universe.name, universe.rooms.map((room) => room.name)]),
        [
            ["BAWES Universe", ["Headquarters"]],
            ["Acme Universe", ["Design Lab", "Lobby"]],
        ]
    );

    // Two rooms with as many people: A to Z, whatever their bots.
    const tied = groupUniverses(
        {
            [url("u/w/zeta")]: { people: 2, bots: 0, names: [] },
            [url("u/w/alpha")]: { people: 2, bots: 30, names: [] },
            [url("v/w/room")]: { people: 4, bots: 0, names: [] },
            [url("b/w/room")]: { people: 4, bots: 0, names: [] },
        },
        new Map()
    );
    assert.deepEqual(
        tied.map((universe) => [universe.name, universe.rooms.map((room) => room.name)]),
        [
            ["b", ["room"]],
            ["u", ["alpha", "zeta"]],
            ["v", ["room"]],
        ]
    );
});

test("a universe card has its colour, its counts, each room and a Visit button per room", () => {
    const { universes } = buildReport(ROOMS, METADATA, ICONS, NOW);
    assert.equal(universes.length, 2);

    const acme = universes[1];
    const embed = acme.embeds![0];
    assert.equal(embed.title, "<:universe_planet:1> Acme Universe");
    assert.equal(embed.color, 0xd946ef);
    assert.equal(embed.description, "**3 people** · 1 bot in 2 rooms");
    assert.deepEqual(embed.fields, [
        {
            name: "<:universe_room:3> Design Lab",
            value: "<:universe_world:2> Studio World\n<:universe_people:4> **2 people** · 1 bot\nSara, Noor",
            inline: false,
        },
        {
            name: "<:universe_room:3> Lobby",
            value: "<:universe_world:2> Main World\n<:universe_people:4> **1 person**\nOmar",
            inline: false,
        },
    ]);
    assert.deepEqual(acme.components, [
        {
            type: 1,
            components: [
                { type: 2, style: 5, label: "Visit Design Lab", url: url("acme/studio/lab"), emoji: { id: "3", name: "universe_room" } },
                { type: 2, style: 5, label: "Visit Lobby", url: url("acme/main/lobby"), emoji: { id: "3", name: "universe_room" } },
            ],
        },
    ]);
    // Typed names are shown as typed, not as formatting.
    assert.match(universes[0].embeds![0].fields![0].value, /AH\\\(Melon\\\)/);
});

test("nobody online: only the summary, saying so, with Last updated", () => {
    const report = buildReport({ [url("u/w/r")]: { people: 0, bots: 3, names: [] } }, new Map(), ICONS, NOW);
    assert.deepEqual(report.universes, []);
    const embed = report.summary.embeds![0];
    assert.equal(embed.description, "No one is online right now.");
    assert.deepEqual(embed.fields!.map((field) => field.name), ["<:universe_clock:5> Last updated"]);
});

test("without icons (Discord said no) the words still read, and buttons carry no emoji", () => {
    const { summary, universes } = buildReport(ROOMS, METADATA, {}, NOW);
    assert.equal(summary.embeds![0].fields![0].name, "People online");
    assert.equal(universes[0].embeds![0].title, "BAWES Universe");
    assert.equal(universes[0].embeds![0].fields![0].name, "Headquarters");
    assert.deepEqual(universes[0].components![0].components[0], {
        type: 2,
        style: 5,
        label: "Visit Headquarters",
        url: url("bawes/world/hq"),
    });
});

test("without Orbit's names the room's address stands in, in Orbit's first universe colour", () => {
    const { universes } = buildReport({ [url("acme/main/lobby")]: { people: 1, bots: 0, names: ["Omar"] } }, new Map(), {}, NOW);
    const embed = universes[0].embeds![0];
    assert.equal(embed.title, "acme");
    assert.equal(embed.color, 0x8b5cf6);
    assert.equal(embed.fields![0].name, "lobby");
    assert.equal(embed.fields![0].value, "main\n**1 person**\nOmar");
});

test("a universe takes its name from any of its rooms Orbit knows, not only the first", () => {
    const rooms: RoomDetailsMap = {
        [url("acme/main/lobby")]: { people: 1, bots: 0, names: ["Omar"] },
        [url("acme/studio/lab")]: { people: 2, bots: 0, names: ["Sara", "Noor"] },
    };
    const metadata = new Map<string, RoomMetadata>([
        ["acme/studio/lab", { universeName: "Acme Universe", worldName: "Studio World", roomName: "Design Lab", universeColour: "#d946ef" }],
    ]);
    const [universe] = groupUniverses(rooms, metadata, "https://play.test");
    assert.equal(universe.name, "Acme Universe");
    assert.equal(universe.colour, "#d946ef");
});

test("ten names, then how many more", () => {
    const names = Array.from({ length: 22 }, (_, index) => `P${index + 1}`);
    assert.equal(namesLine(names), "P1, P2, P3, P4, P5, P6, P7, P8, P9, P10 and 12 more");
    assert.equal(namesLine(names.slice(0, 10)), "P1, P2, P3, P4, P5, P6, P7, P8, P9, P10");
    assert.equal(escapeMarkdown("**bold** _x_ <@everyone> [a](b)"), "\\*\\*bold\\*\\* \\_x\\_ \\<@everyone\\> \\[a\\]\\(b\\)");
});

test("a universe with more than 25 rooms carries on in a next post, so every room keeps its card and button", () => {
    const universe: ReportUniverse = {
        name: "Big",
        colour: "#6366f1",
        people: 30,
        bots: 0,
        rooms: Array.from({ length: 30 }, (_, index) => ({
            url: url(`big/w/r${index}`),
            name: `Room ${index}`,
            world: "W",
            people: 1,
            bots: 0,
            names: ["Someone with a long name that goes on"],
        })),
    };
    const posts = buildUniversePosts(universe, ICONS);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].embeds![0].fields!.length, 25);
    assert.equal(posts[0].embeds![0].description, "**30 people** in 30 rooms");
    assert.equal(posts[1].embeds![0].fields!.length, 5);
    assert.equal(posts[1].embeds![0].description, undefined);
    assert.equal(posts[1].embeds![0].title, posts[0].embeds![0].title);
    for (const post of posts) {
        const buttons = post.components!.flatMap((row) => row.components);
        assert.equal(buttons.length, post.embeds![0].fields!.length);
        assert.ok(post.components!.every((row) => row.components.length <= 5));
        const embed = post.embeds![0];
        const text =
            (embed.title?.length ?? 0) +
            (embed.description?.length ?? 0) +
            embed.fields!.reduce((total, field) => total + field.name.length + field.value.length, 0);
        assert.ok(text <= 6000);
    }
});

test("long room lists stay within Discord's 6000 characters per post", () => {
    const longNames = Array.from({ length: 10 }, (_, index) => `${"N".repeat(38)}${index}`);
    const universe: ReportUniverse = {
        name: "Busy",
        colour: "#6366f1",
        people: 200,
        bots: 0,
        rooms: Array.from({ length: 20 }, (_, index) => ({
            url: url(`busy/w/r${index}`),
            name: `Room ${index}`,
            world: "World",
            people: 10,
            bots: 0,
            names: longNames,
        })),
    };
    const posts = buildUniversePosts(universe, ICONS);
    assert.ok(posts.length > 1);
    assert.equal(posts.reduce((total, post) => total + post.embeds![0].fields!.length, 0), 20);
    for (const post of posts) {
        const embed = post.embeds![0];
        const text =
            (embed.title?.length ?? 0) +
            (embed.description?.length ?? 0) +
            embed.fields!.reduce((total, field) => total + field.name.length + field.value.length, 0);
        assert.ok(text <= 6000, `post has ${text} characters`);
    }
});
