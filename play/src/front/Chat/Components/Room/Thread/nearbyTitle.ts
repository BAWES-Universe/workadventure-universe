import type { TranslationFunctions } from "../../../../../i18n/i18n-types";
import type { TopRowPerson, TopRowState } from "../../TopRow/TopRowSummary";

/**
 * What the proximity chat is called and the line under it, in its header and its details: the area's name or the
 * chat's own, then who you're talking with now, or what to do to talk to someone.
 */
export function nearbyTitleLines<P extends TopRowPerson>(
    state: TopRowState<P>,
    names: string,
    LL: TranslationFunctions
): { title: string; subtitle: string; isLive: boolean } {
    const isLive = state.kind === "withPeople";
    const title = ("areaName" in state && state.areaName) || LL.chat.nearby.title();
    const subtitle = isLive
        ? LL.chat.nearby.talkingNow() + LL.chat.topRow.separator() + LL.chat.thread.withPeople({ names })
        : state.kind === "meetingAlone"
        ? LL.chat.topRow.onlyYouHere()
        : state.kind === "alone"
        ? LL.chat.nearby.idle()
        : LL.chat.nearby.title();
    return { title, subtitle, isLive };
}
