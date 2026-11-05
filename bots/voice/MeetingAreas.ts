/**
 * A voice bot in a meeting room. A meeting room is an area of the map with the LiveKit room setting; the people
 * standing in it share a space named after it (the same name the game joins it with), and that space carries their
 * audio like a bubble does. A voice bot that stands in such an area joins that space, so everything else (peer or
 * LiveKit, tokens, who is heard) is what already happens in a bubble.
 *
 * Who may join is the game's: the server refuses a voice bot the areas a player with the bot's roles would not be
 * let into (back: refusedAreaSpaces). On top of that the bot waits at the door of a room that is locked or full,
 * like a player does, and does not hop in and out of a room it only walks past.
 */
import { areaSpaceName } from '../../libs/shared-utils/src/Space/areaSpaceName';

export interface MeetingArea {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** The name of the meeting room, as the game names its space: the room name, or the setting's id when it has none. */
    roomKey: string;
    /** "Max people", when it is on. */
    maxUsers?: { propertyId: string; maxUsers: number };
    /** "Lockable room", when it is on. */
    lockPropertyId?: string;
}

/** The game keys the live state of an area setting by these names (libs/map-editor AreaCapacity). */
export const AREA_USERS_INSIDE_KEY = 'usersInside';
export const AREA_LOCK_KEY = 'lock';

/** How far below a player's position their feet are, in game pixels (the game's own rule for being inside an area). */
const FEET_OFFSET_Y = 16;

const active = (property: any): boolean => property && property.disabled !== true;

/** The meeting rooms of a map file (the WAM's `areas`), as raw JSON. Anything malformed is skipped. */
export function meetingAreasFromWam(wam: any): MeetingArea[] {
    const raw = Array.isArray(wam?.areas) ? wam.areas : wam?.areas && typeof wam.areas === 'object' ? Object.values(wam.areas) : [];
    const out: MeetingArea[] = [];
    for (const area of raw as any[]) {
        if (!area || typeof area.id !== 'string' || !Array.isArray(area.properties)) continue;
        const { x, y, width, height } = area;
        if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
        const livekit = area.properties.find((p: any) => p?.type === 'livekitRoomProperty' && active(p));
        if (!livekit) continue;
        const roomName = typeof livekit.roomName === 'string' ? livekit.roomName : '';
        const roomKey = roomName.trim().length === 0 ? String(livekit.id ?? '') : roomName;
        if (roomKey.length === 0) continue;
        const max = area.properties.find((p: any) => p?.type === 'maxUsersInAreaPropertyData' && active(p) && typeof p.maxUsers === 'number' && p.maxUsers >= 1);
        const lock = area.properties.find((p: any) => p?.type === 'lockableAreaPropertyData' && active(p));
        out.push({
            id: area.id,
            x,
            y,
            width,
            height,
            roomKey,
            ...(max ? { maxUsers: { propertyId: String(max.id), maxUsers: Math.floor(max.maxUsers) } } : {}),
            ...(lock ? { lockPropertyId: String(lock.id) } : {}),
        });
    }
    return out;
}

export function isInsideMeetingArea(position: { x: number; y: number }, area: MeetingArea): boolean {
    const y = position.y + FEET_OFFSET_Y;
    return position.x >= area.x && position.x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
}

export interface MeetingHost {
    /** Joins the meeting's space. False when it did not work (for example the game refused). */
    join(spaceName: string): Promise<boolean>;
    leave(spaceName: string): Promise<void>;
}

/** The bot has to be in or out of a spot this long before it joins or leaves, so passing through changes nothing. */
const DWELL_MS = 2500;
/** After a refusal the same room is not tried again for this long. */
const RETRY_AFTER_REFUSAL_MS = 30000;

export class MeetingPresence {
    private areas: MeetingArea[] = [];
    private roomUrl = '';
    private current?: { spaceName: string; area: MeetingArea };
    private since?: { key: string; at: number };
    private busy = false;
    private readonly refusedUntil = new Map<string, number>();
    /** Live state of area settings, by "areaId\npropertyId\nkey". */
    private readonly live = new Map<string, string>();

    constructor(private readonly host: MeetingHost, private readonly now: () => number = Date.now) {}

    setAreas(areas: MeetingArea[], roomUrl: string): void {
        this.areas = areas;
        this.roomUrl = roomUrl;
    }

    hasAreas(): boolean {
        return this.areas.length > 0;
    }

    /** The meeting space the bot is in (or is joining). */
    owns(spaceName: string): boolean {
        return this.current?.spaceName === spaceName;
    }

    /** The game shares the number of people inside and whether a lockable room is locked (AreaPropertyVariableMessage). */
    setLive(areaId: string, propertyId: string, key: string, value: string): void {
        this.live.set(`${areaId}\n${propertyId}\n${key}`, value);
    }

    /** The connection to the game ended: nothing of the bot's spaces is left. */
    reset(): void {
        this.current = undefined;
        this.since = undefined;
        this.busy = false;
        this.live.clear();
    }

    /** The game took the bot out of a space (its rights changed, say): that room is left alone for a while. */
    spaceLeft(spaceName: string): void {
        if (this.current?.spaceName !== spaceName) return;
        this.current = undefined;
        this.refusedUntil.set(spaceName, this.now() + RETRY_AFTER_REFUSAL_MS);
    }

    /** Called as often as the bot's position is looked at. */
    update(position: { x: number; y: number }): void {
        if (this.busy || this.areas.length === 0) return;
        const now = this.now();
        if (this.current) {
            if (isInsideMeetingArea(position, this.current.area)) {
                this.since = undefined;
                return;
            }
            if (this.dwelled(`leave:${this.current.spaceName}`, now)) {
                const { spaceName } = this.current;
                this.current = undefined;
                this.since = undefined;
                this.busy = true;
                this.host.leave(spaceName).catch(() => undefined).finally(() => (this.busy = false));
            }
            return;
        }
        const target = this.areas.find((area) => isInsideMeetingArea(position, area) && this.admitted(area, now));
        if (!target) {
            this.since = undefined;
            return;
        }
        const spaceName = areaSpaceName(target.roomKey, this.roomUrl);
        if (!this.dwelled(`join:${spaceName}`, now)) return;
        this.since = undefined;
        this.busy = true;
        this.current = { spaceName, area: target };
        this.host
            .join(spaceName)
            .then((ok) => {
                if (!ok && this.current?.spaceName === spaceName) {
                    this.current = undefined;
                    this.refusedUntil.set(spaceName, this.now() + RETRY_AFTER_REFUSAL_MS);
                }
            })
            .catch(() => {
                if (this.current?.spaceName === spaceName) this.current = undefined;
                this.refusedUntil.set(spaceName, this.now() + RETRY_AFTER_REFUSAL_MS);
            })
            .finally(() => (this.busy = false));
    }

    /** Whether a player standing here would be let in: not locked, not full, and not refused a moment ago. */
    private admitted(area: MeetingArea, now: number): boolean {
        if ((this.refusedUntil.get(areaSpaceName(area.roomKey, this.roomUrl)) ?? 0) > now) return false;
        if (area.lockPropertyId && this.live.get(`${area.id}\n${area.lockPropertyId}\n${AREA_LOCK_KEY}`) === 'true') return false;
        if (area.maxUsers) {
            const inside = Number(this.live.get(`${area.id}\n${area.maxUsers.propertyId}\n${AREA_USERS_INSIDE_KEY}`) ?? 0);
            if (inside >= area.maxUsers.maxUsers) return false;
        }
        return true;
    }

    private dwelled(key: string, now: number): boolean {
        if (this.since?.key !== key) {
            this.since = { key, at: now };
            return false;
        }
        return now - this.since.at >= DWELL_MS;
    }
}
