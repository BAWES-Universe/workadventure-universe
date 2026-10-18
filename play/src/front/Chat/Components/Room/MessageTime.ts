/** The time on chat labels and notices: "9:05 PM" in English, without a leading zero. */
export function chatTime(date: Date, locale: string): string {
    return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}
