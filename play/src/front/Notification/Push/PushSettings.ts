/**
 * What someone wants notifications about, from whom and when, as Orbit keeps it for their account (#863). The
 * device's own on/off is not here: each browser says yes for itself.
 */
export type DmSource = "friends_members" | "friends" | "anyone";

export interface QuietHours {
    /** "HH:MM", 24 hours, in `timeZone` */
    start: string;
    end: string;
    timeZone: string;
}

export interface PushSettings {
    directMessages: boolean;
    friendRequests: boolean;
    memberships: boolean;
    friendInRoom: boolean;
    friendLive: boolean;
    dmFrom: DmSource;
    /** Show message text; off shows "New message from Sara" */
    previews: boolean;
    /** null = Off */
    quietHours: QuietHours | null;
}

export interface PushDeviceView {
    id: string;
    label: string;
    enabled: boolean;
    lastNotifiedAt: string | null;
    createdAt: string;
}

export interface PushOverview {
    /** null while notifications are not set up on this server */
    publicKey: string | null;
    settings: PushSettings;
    devices: PushDeviceView[];
}

/** The quiet hours offered: the nights most people sleep through. */
export const QUIET_HOURS_CHOICES: ReadonlyArray<{ start: string; end: string }> = [
    { start: "22:00", end: "07:00" },
    { start: "23:00", end: "07:00" },
    { start: "00:00", end: "08:00" },
];

/** "22:00-07:00", the value of a quiet hours choice, or "off". */
export function quietHoursValue(quietHours: QuietHours | null): string {
    return quietHours ? `${quietHours.start}-${quietHours.end}` : "off";
}

/** "10:00 PM – 7:00 AM" in the player's language. */
export function quietHoursLabel(start: string, end: string, locale: string): string {
    const format = (time: string) => {
        const [hours, minutes] = time.split(":").map(Number);
        return new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" }).format(
            new Date(Date.UTC(2026, 0, 1, hours, minutes))
        );
    };
    return `${format(start)} – ${format(end)}`;
}

/** "2 hours ago", "yesterday": when a device last got a notification. */
export function lastNotifiedLabel(lastNotifiedAt: string, now: number, locale: string): string {
    const seconds = Math.round((new Date(lastNotifiedAt).getTime() - now) / 1000);
    const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "long" });
    const abs = Math.abs(seconds);
    if (abs < 60) return format.format(0, "second");
    if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
    if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
    return format.format(Math.round(seconds / 86400), "day");
}
