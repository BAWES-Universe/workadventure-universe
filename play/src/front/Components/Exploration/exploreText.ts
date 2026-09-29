/**
 * A room's busiest hour, sent as a UTC hour (0-23), on the viewer's own clock ("4 PM"). Today's offset is used so
 * daylight saving is respected. Same rule as Orbit's peak.
 */
export function formatPeakHour(utcHour: number, now: Date = new Date()): string {
    const at = new Date(now.getTime());
    at.setUTCHours(utcHour, 0, 0, 0);
    const hour = at.getHours();
    return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * A universe, world or room name as the Explore list shows it: first letter capitalised, the rest as typed. A name
 * typed all in capitals ("TEST") is written as a sentence ("Test"), since nothing in the list shouts.
 */
export function displayName(name: string): string {
    const shouting = name === name.toLocaleUpperCase() && name !== name.toLocaleLowerCase();
    const rest = shouting ? name.slice(1).toLocaleLowerCase() : name.slice(1);
    return name.charAt(0).toLocaleUpperCase() + rest;
}
