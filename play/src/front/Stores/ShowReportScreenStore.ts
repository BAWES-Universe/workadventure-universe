import { writable } from "svelte/store";

export const userReportEmpty = {
    userUuid: "",
    userName: "Empty",
};

export const showReportScreenStore = writable<{ userUuid: string; userName: string }>(userReportEmpty);

/**
 * The world whose admins just got a report, for the short "Report sent" note shown once the popup closes; undefined
 * when there is no note.
 */
export const reportSentToastStore = writable<string | undefined>(undefined);
