/**
 * Time for a Brick that sets reminders (game #2002): the model speaks in the person's own clock ("2026-11-15 16:00"), never in
 * offsets, and this turns that into the moment Orbit keeps, and Orbit's moments back into words on the same clock.
 * Pure: no clock of its own.
 */

const MINUTE = 60 * 1000;

/** Whether the runtime knows this time zone ("Asia/Kuwait", "Europe/London", "UTC"). */
export function isTimeZone(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

interface Wall {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

function wallOf(at: number, timeZone: string): Wall {
    const parts: Record<string, number> = {};
    for (const part of new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(at))) {
        if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour === 24 ? 0 : parts.hour, minute: parts.minute };
}

/** Minutes this zone is ahead of UTC at this instant (Kuwait: 180). */
function offsetMinutes(at: number, timeZone: string): number {
    const wall = wallOf(at, timeZone);
    return Math.round((Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - Math.floor(at / MINUTE) * MINUTE) / MINUTE);
}

/**
 * "2026-11-15 16:00" (or with a T) on the clock of `timeZone`, as the moment it means (ISO, with Z), or null when it is not a real
 * date and time.
 */
export function localToInstant(local: unknown, timeZone: string): string | null {
    if (typeof local !== 'string' || !isTimeZone(timeZone)) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(local.trim());
    if (!match) return null;
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    const wall = Date.UTC(year, month - 1, day, hour, minute);
    const check = new Date(wall);
    // 31 February, 25:00 and the like are not times
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;
    // The zone's offset at that wall time, found in two passes so a time just after a clock change gets the new offset
    const guess = wall - offsetMinutes(wall, timeZone) * MINUTE;
    return new Date(wall - offsetMinutes(guess, timeZone) * MINUTE).toISOString();
}

/** A moment in words on the person's clock: "Sun 15 Nov, 4:00 PM". Their own zone's name goes beside it where it matters. */
export function sayMoment(iso: string, timeZone: string, now: number): string {
    const at = new Date(iso);
    const zone = isTimeZone(timeZone) ? timeZone : 'UTC';
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }).format(at);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(at);
    const today = wallOf(now, zone);
    const that = wallOf(at.getTime(), zone);
    const sameDay = today.year === that.year && today.month === that.month && today.day === that.day;
    return sameDay ? `today, ${time}` : `${day}, ${time}`;
}

/** What the clock on the person's wall reads now, for the Brick's note: "Thu 12 Nov 2026, 9:00 AM". */
export function sayNow(now: number, timeZone: string): string {
    const zone = isTimeZone(timeZone) ? timeZone : 'UTC';
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(now));
    const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(now));
    return `${day}, ${time}`;
}

/** The time of day (HH:mm) in "2026-11-15 16:00", for a reminder that comes every day. */
export function timeOfDayOf(local: unknown): string | null {
    const match = typeof local === 'string' ? /^\d{4}-\d{2}-\d{2}[ T]([01]\d|2[0-3]):([0-5]\d)(?::\d{2})?$/.exec(local.trim()) : null;
    return match ? `${match[1]}:${match[2]}` : null;
}
