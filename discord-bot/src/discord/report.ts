import type { DiscordActionRow, DiscordButton, DiscordEmbed, DiscordMessagePayload, RoomDetailsMap, RoomMetadata } from "../types";
import { getRoomClickableUrl, parseRoomUrl } from "./channels";

/**
 * The stats channel's report (#1389, mock "Discord v3 A"): a summary post, then one post per universe with a card
 * (its rooms, their people and bots, who is there) and a "Visit <room>" button per room. Only rooms with at least one
 * person are listed. Universes with the most people come first, then rooms with the most people inside each; bots
 * never change the order, and a tie goes A to Z.
 */

/** Orbit's icons, as the app's own emoji (emoji.ts). A missing one shows as nothing, so the words still read. */
export type IconKey = "universe" | "world" | "room" | "people" | "clock";
export type ReportIcons = Partial<Record<IconKey, { id: string; name: string }>>;

/** Orbit's first universe colour, for a universe whose colour Orbit did not send. */
export const FALLBACK_UNIVERSE_COLOUR = "#8b5cf6";
const SUMMARY_COLOUR = 0x5865f2;
const NAMES_SHOWN = 10;
const NAME_MAX = 40;
// Discord's limits: 25 fields per embed and 25 buttons (5 rows of 5) per message, 6000 characters of embed text per
// message, 256 per title and field name, 1024 per field value, 80 per button label.
const ROOMS_PER_POST = 25;
const BUTTONS_PER_ROW = 5;
const EMBED_TEXT_BUDGET = 5500;
const TITLE_MAX = 256;
const FIELD_VALUE_MAX = 1024;
const BUTTON_LABEL_MAX = 80;

export interface ReportRoom {
    url: string;
    name: string;
    world: string;
    people: number;
    bots: number;
    names: string[];
}

export interface ReportUniverse {
    name: string;
    colour: string;
    people: number;
    bots: number;
    rooms: ReportRoom[];
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

/** "**6 people** · 21 bots", or "**6 people**" with no bots. */
export function peopleAndBots(people: number, bots: number): string {
    const text = `**${plural(people, "person", "people")}**`;
    return bots > 0 ? `${text} · ${plural(bots, "bot", "bots")}` : text;
}

/** Shortens text to max characters, with "…" when it was cut. */
function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Names are typed by people: anything Discord would read as formatting, a link or a mention is shown as typed. */
export function escapeMarkdown(text: string): string {
    return text.replace(/[\\*_~`|>#<[\]()-]/g, "\\$&");
}

function icon(icons: ReportIcons, key: IconKey): string {
    const emoji = icons[key];
    return emoji ? `<:${emoji.name}:${emoji.id}> ` : "";
}

function colourOf(hex: string | undefined): number {
    const colour = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : FALLBACK_UNIVERSE_COLOUR;
    return parseInt(colour.slice(1), 16);
}

/** "Khalid, Sara and 12 more": the first ten names, then how many more. */
export function namesLine(names: string[]): string {
    const shown = names.slice(0, NAMES_SHOWN).map((name) => escapeMarkdown(clip(name.trim() || "?", NAME_MAX)));
    const more = names.length - shown.length;
    return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

/**
 * The rooms with at least one person, grouped by universe and sorted. Names come from Orbit (metadata, keyed by
 * "universe/world/room"); without them, the room's address stands in.
 */
export function groupUniverses(
    rooms: RoomDetailsMap,
    metadata: Map<string, RoomMetadata>,
    baseUrl?: string
): ReportUniverse[] {
    const universes = new Map<string, ReportUniverse>();
    for (const [roomUrl, details] of Object.entries(rooms)) {
        if (details.people < 1) continue;
        const path = parseRoomUrl(roomUrl);
        const [universeSlug = "", worldSlug = "", roomSlug = ""] = path.split("/");
        const names = metadata.get(path);
        const universeKey = universeSlug || path;
        let universe = universes.get(universeKey);
        if (!universe) {
            universe = {
                name: names?.universeName || universeSlug || "Universe",
                colour: names?.universeColour || FALLBACK_UNIVERSE_COLOUR,
                people: 0,
                bots: 0,
                rooms: [],
            };
            universes.set(universeKey, universe);
        }
        if (names?.universeName) universe.name = names.universeName;
        if (names?.universeColour) universe.colour = names.universeColour;
        universe.people += details.people;
        universe.bots += details.bots;
        universe.rooms.push({
            url: getRoomClickableUrl(roomUrl, baseUrl),
            name: names?.roomName || roomSlug || path,
            world: names?.worldName || worldSlug,
            people: details.people,
            bots: details.bots,
            names: details.names ?? [],
        });
    }
    const sorted = [...universes.values()];
    for (const universe of sorted) {
        universe.rooms.sort((a, b) => b.people - a.people || byName(a.name, b.name));
    }
    return sorted.sort((a, b) => b.people - a.people || byName(a.name, b.name));
}

/** The first post: everyone online, the rooms they are in, and when this was written. */
export function buildSummary(universes: ReportUniverse[], now: Date, icons: ReportIcons): DiscordMessagePayload {
    const lastUpdated = {
        name: `${icon(icons, "clock")}Last updated`,
        value: `<t:${Math.floor(now.getTime() / 1000)}:R>`,
        inline: true,
    };
    if (universes.length === 0) {
        return {
            embeds: [
                {
                    title: "Universe right now",
                    description: "No one is online right now.",
                    color: SUMMARY_COLOUR,
                    fields: [lastUpdated],
                },
            ],
        };
    }
    const people = universes.reduce((total, universe) => total + universe.people, 0);
    const bots = universes.reduce((total, universe) => total + universe.bots, 0);
    const rooms = universes.reduce((total, universe) => total + universe.rooms.length, 0);
    return {
        embeds: [
            {
                title: "Universe right now",
                color: SUMMARY_COLOUR,
                fields: [
                    {
                        name: `${icon(icons, "people")}People online`,
                        value: bots > 0 ? `**${people}** · ${plural(bots, "bot", "bots")}` : `**${people}**`,
                        inline: true,
                    },
                    {
                        name: `${icon(icons, "room")}Active rooms`,
                        value: `**${rooms}** in ${plural(universes.length, "universe", "universes")}`,
                        inline: true,
                    },
                    lastUpdated,
                ],
            },
        ],
    };
}

function roomField(room: ReportRoom, icons: ReportIcons): NonNullable<DiscordEmbed["fields"]>[number] {
    const lines = [
        ...(room.world ? [`${icon(icons, "world")}${escapeMarkdown(room.world)}`] : []),
        `${icon(icons, "people")}${peopleAndBots(room.people, room.bots)}`,
        ...(room.names.length > 0 ? [namesLine(room.names)] : []),
    ];
    return {
        name: clip(`${icon(icons, "room")}${room.name}`, TITLE_MAX),
        value: clip(lines.join("\n"), FIELD_VALUE_MAX),
        inline: false,
    };
}

function fieldLength(field: { name: string; value: string }): number {
    return field.name.length + field.value.length;
}

function visitButtons(rooms: ReportRoom[], icons: ReportIcons): DiscordActionRow[] {
    const buttons: DiscordButton[] = rooms
        .filter((room) => /^https?:\/\//.test(room.url))
        .map((room) => ({
            type: 2,
            style: 5,
            label: clip(`Visit ${room.name}`, BUTTON_LABEL_MAX),
            url: room.url,
            ...(icons.room ? { emoji: { id: icons.room.id, name: icons.room.name } } : {}),
        }));
    const rows: DiscordActionRow[] = [];
    for (let start = 0; start < buttons.length; start += BUTTONS_PER_ROW) {
        rows.push({ type: 1, components: buttons.slice(start, start + BUTTONS_PER_ROW) });
    }
    return rows;
}

/**
 * One universe's post: its card and a Visit button per room. Discord puts buttons under the whole message, so each
 * universe is its own post. A universe too big for one post (over 25 rooms, or Discord's text limit) carries on in a
 * next post with the same title, so every room keeps its card and its button.
 */
export function buildUniversePosts(universe: ReportUniverse, icons: ReportIcons): DiscordMessagePayload[] {
    const title = clip(`${icon(icons, "universe")}${universe.name}`, TITLE_MAX);
    const description = `${peopleAndBots(universe.people, universe.bots)} in ${plural(universe.rooms.length, "room", "rooms")}`;
    const color = colourOf(universe.colour);

    const posts: DiscordMessagePayload[] = [];
    let rooms: ReportRoom[] = [];
    let fields: NonNullable<DiscordEmbed["fields"]> = [];
    let length = title.length + description.length;
    const flush = () => {
        const embed: DiscordEmbed = { title, color, fields };
        if (posts.length === 0) embed.description = description;
        posts.push({ embeds: [embed], components: visitButtons(rooms, icons) });
        rooms = [];
        fields = [];
        length = title.length;
    };
    for (const room of universe.rooms) {
        const field = roomField(room, icons);
        if (fields.length > 0 && (fields.length >= ROOMS_PER_POST || length + fieldLength(field) > EMBED_TEXT_BUDGET)) {
            flush();
        }
        fields.push(field);
        rooms.push(room);
        length += fieldLength(field);
    }
    if (fields.length > 0) flush();
    return posts;
}

/** The whole report: the summary post, then the universes' posts in order. */
export function buildReport(
    rooms: RoomDetailsMap,
    metadata: Map<string, RoomMetadata>,
    icons: ReportIcons,
    now: Date,
    baseUrl?: string
): { summary: DiscordMessagePayload; universes: DiscordMessagePayload[] } {
    const universes = groupUniverses(rooms, metadata, baseUrl);
    return {
        summary: buildSummary(universes, now, icons),
        universes: universes.flatMap((universe) => buildUniversePosts(universe, icons)),
    };
}
