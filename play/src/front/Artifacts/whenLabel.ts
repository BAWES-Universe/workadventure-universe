/** "5:54 AM" for today, with the day in front for any other: when a version was made, in the reader's own clock. */
export function whenLabel(iso: string, now: Date = new Date()): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (date.toDateString() === now.toDateString()) return time;
    return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
