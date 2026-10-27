/**
 * What models.dev does not say, or says differently from the provider's own price page (#1173). Short on purpose:
 * everything else comes from the list.
 */

/**
 * Old model ids a provider still answers to, and the model it serves them with. DeepSeek's page retired these two; its
 * V4 Flash is what answers, and the list no longer has them.
 */
export const MODEL_ALIASES: Record<string, Record<string, string>> = {
    deepseek: { 'deepseek-chat': 'deepseek-flash', 'deepseek-reasoner': 'deepseek-flash' },
};

/**
 * DeepSeek charges half as much off-peak (https://api-docs.deepseek.com/quick_start/pricing, read 26 Oct 2026):
 * "Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays.
 * Off-peak rates are half of the peak rates." models.dev lists the off-peak price, so a call in peak hours costs twice
 * the listed price on every line (input, cached input, output). The page does not say whether the hour is the one the
 * request is sent in, so that is what is used. Weekends and Chinese public holidays are off-peak all day.
 */
export const DEEPSEEK_PROVIDER = 'deepseek';
export const DEEPSEEK_PEAK_FACTOR = 2;
/** Start (inclusive) and end (exclusive) hour in UTC. */
export const DEEPSEEK_PEAK_HOURS_UTC: Array<[number, number]> = [[1, 4], [6, 10]];

/**
 * Chinese statutory public holidays, whole days off (State Council notice for 2026, as listed by
 * https://www.china-briefing.com/news/china-2026-public-holiday-schedule/). A holiday is off-peak all day. The days are
 * Beijing dates; the peak hours (01:00 to 10:00 UTC) fall inside the same date there (09:00 to 18:00), so the UTC date
 * is the Beijing date. Weekend make-up working days stay off-peak: the page says Monday through Friday.
 * The list ends with the year. Add the next year's from the State Council notice (published in December); a call
 * dated after the end is still priced by the rule above, and says so once in the log.
 */
export const CHINESE_HOLIDAYS: Array<[from: string, to: string]> = [
    ['2026-01-01', '2026-01-03'],
    ['2026-02-15', '2026-02-23'],
    ['2026-04-04', '2026-04-06'],
    ['2026-05-01', '2026-05-05'],
    ['2026-06-19', '2026-06-21'],
    ['2026-09-25', '2026-09-27'],
    ['2026-10-01', '2026-10-07'],
];
export const CHINESE_HOLIDAYS_COVER_UNTIL = '2026-12-31';

/** `YYYY-MM-DD` of a moment in UTC. */
const dayOf = (at: Date): string => at.toISOString().slice(0, 10);

export function isChineseHoliday(at: Date): boolean {
    const day = dayOf(at);
    return CHINESE_HOLIDAYS.some(([from, to]) => day >= from && day <= to);
}

/** Is `at` inside DeepSeek's peak hours? */
export function isDeepSeekPeak(at: Date): boolean {
    const weekday = at.getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
    const hour = at.getUTCHours();
    if (!DEEPSEEK_PEAK_HOURS_UTC.some(([from, to]) => hour >= from && hour < to)) return false;
    return !isChineseHoliday(at);
}

let warnedHolidayListEnded = false;

/** Says once that a DeepSeek call is dated past the holiday list, so a holiday there would be priced as a working day. */
export function warnIfHolidaysUnknown(at: Date): void {
    if (warnedHolidayListEnded || dayOf(at) <= CHINESE_HOLIDAYS_COVER_UNTIL) return;
    warnedHolidayListEnded = true;
    console.warn(`[pricing] The Chinese holiday list in bots/ai/pricing/overrides.ts ends ${CHINESE_HOLIDAYS_COVER_UNTIL}; DeepSeek calls after it are priced as peak on weekdays even on a holiday.`);
}
