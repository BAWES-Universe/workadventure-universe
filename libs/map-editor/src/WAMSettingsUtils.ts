import type { WAMFileFormat } from "./types";

/** How far a live broadcast reaches: the room, every room of the world, or every room of the universe. */
export type MegaphoneScope = "ROOM" | "WORLD" | "UNIVERSE";

/** A broadcast channel a room listens to: the space joined for it, and whether a given user may go live on it. */
export interface MegaphoneChannelDescription {
    scope: MegaphoneScope;
    url: string;
    canStream: boolean;
}

/** The reaches from narrowest to widest: each one includes the ones before it. */
export const MEGAPHONE_SCOPES: MegaphoneScope[] = ["ROOM", "WORLD", "UNIVERSE"];

/** Who may go live in a room nobody has set up yet: its admins. */
export const DEFAULT_MEGAPHONE_RIGHTS = ["admin"];

export class WAMSettingsUtils {
    /**
     * The reaches people may go live at from this room. A room nobody has set up lets them reach everywhere (who may
     * is admins, see hasMegaphoneRights). A reach includes the narrower ones: a room saved with "WORLD" alone, or
     * configured before "scopes" existed with a single "scope" (WORLD by default), also reaches its own room.
     */
    static getMegaphoneScopes(wamSettings: WAMFileFormat["settings"]): MegaphoneScope[] {
        const megaphone = wamSettings?.megaphone;
        if (!megaphone) {
            return [...MEGAPHONE_SCOPES];
        }
        if (!megaphone.enabled) {
            return [];
        }
        const saved = megaphone.scopes ?? [megaphone.scope ?? "WORLD"];
        const widest = Math.max(...saved.map((scope) => MEGAPHONE_SCOPES.indexOf(scope as MegaphoneScope)));
        return MEGAPHONE_SCOPES.slice(0, widest + 1);
    }

    /**
     * Every broadcast channel this room listens to, and whether a user carrying these tags may go live on each:
     * - ROOM and WORLD follow the room's settings (which reaches are on, and who may use them);
     * - UNIVERSE exists for every room of an Orbit universe (its group is "universe/world"), so a universe-wide
     *   broadcast from anywhere arrives here; going live on it needs the room's switch on, and admins only.
     * Listeners join every channel; a speaker streams on the one they picked.
     */
    static getMegaphoneChannels(
        wamSettings: WAMFileFormat["settings"],
        roomGroup: string | null | undefined,
        roomUrl: string,
        tags: string[]
    ): MegaphoneChannelDescription[] {
        const channels: MegaphoneChannelDescription[] = [];
        const scopes = WAMSettingsUtils.getMegaphoneScopes(wamSettings);
        const canUseRoomChannels = WAMSettingsUtils.hasMegaphoneRights(wamSettings, tags);
        if (scopes.includes("ROOM")) {
            channels.push({
                scope: "ROOM",
                url: WAMSettingsUtils.toSpaceName(`${roomUrl}/megaphone-room`),
                canStream: canUseRoomChannels,
            });
        }
        // Without Orbit there is no group: the whole host is the world, as it was before groups existed.
        const worldGroup = roomGroup || WAMSettingsUtils.getHost(roomUrl);
        if (scopes.includes("WORLD") && worldGroup) {
            channels.push({
                scope: "WORLD",
                url: WAMSettingsUtils.toSpaceName(`${worldGroup}/megaphone-world`),
                canStream: canUseRoomChannels,
            });
        }
        const universeSlug = WAMSettingsUtils.getUniverseSlug(roomGroup);
        if (universeSlug) {
            channels.push({
                scope: "UNIVERSE",
                url: WAMSettingsUtils.getUniverseMegaphoneSpaceName(universeSlug),
                canStream: scopes.includes("UNIVERSE") && tags.includes("admin"),
            });
        }
        return channels;
    }

    /** The first channel a user with these tags may go live on, for clients that only know one. */
    static getMegaphoneUrl(
        wamSettings: WAMFileFormat["settings"],
        roomGroup: string | null | undefined,
        roomUrl: string,
        tags: string[]
    ): string | undefined {
        return WAMSettingsUtils.getMegaphoneChannels(wamSettings, roomGroup, roomUrl, tags).find(
            (channel) => channel.canStream
        )?.url;
    }

    /** Whether a user with these tags may go live on at least one channel of this room. */
    static canUseMegaphone(
        wamSettings: WAMFileFormat["settings"],
        roomGroup: string | null | undefined,
        roomUrl: string,
        tags: string[]
    ): boolean {
        return WAMSettingsUtils.getMegaphoneChannels(wamSettings, roomGroup, roomUrl, tags).some(
            (channel) => channel.canStream
        );
    }

    /**
     * The room's own rule for who may go live here: admins in a room nobody has set up, everyone when no tag is set,
     * else people with one of the tags (the roles Orbit gives: admin, editor, member).
     */
    static hasMegaphoneRights(wamSettings: WAMFileFormat["settings"], tags: string[]): boolean {
        const megaphone = wamSettings?.megaphone;
        const rights = megaphone ? megaphone.rights : DEFAULT_MEGAPHONE_RIGHTS;
        if (!rights || rights.length === 0) {
            return true;
        }
        return rights.some((right) => tags.includes(right));
    }

    /**
     * The one space every room of a universe listens to for universe-wide broadcasts. The pusher recognises this
     * name to share the space across worlds (every other space stays private to its world).
     */
    static getUniverseMegaphoneSpaceName(universeSlug: string): string {
        return WAMSettingsUtils.toSpaceName(`${universeSlug}/megaphone-universe`);
    }

    /** The universe of an Orbit room, whose group is "universe/world". A plain host (no Orbit) has none. */
    static getUniverseSlug(roomGroup: string | null | undefined): string | undefined {
        if (!roomGroup) {
            return undefined;
        }
        const [universe, world] = roomGroup.split("/");
        if (!universe || !world) {
            return undefined;
        }
        return universe;
    }

    private static getHost(roomUrl: string): string | undefined {
        try {
            return new URL(roomUrl).host;
        } catch {
            return undefined;
        }
    }

    private static toSpaceName(name: string): string {
        return name.replace(/^https?:\/\//, "").replace(/\//g, "-");
    }
}
