import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { peopleCardReturn } from "../../Stores/PeopleCardReturnStore";
import { locatePerson, nearestSessionOnThisMap } from "./PersonNavigation";
import type { PersonLocation } from "./PersonTarget";
import type { Session } from "./PersonSessions";

/**
 * Tapping someone's Woka or name in People: show where they are on the map and open their visit card.
 *
 * The one path for every row that can do this, the Everyone tab's and a friend's who is here, so the two stay in
 * step. The card opens on the exact avatar when it is in view (the one of their sessions closest to you, when they
 * have several), otherwise the server is asked for their position. On a phone the sidebar makes way for the card
 * and comes back when it is closed.
 *
 * Someone with no map to show (not in this world, or no account) has no card to open: nothing happens.
 */
export function openPersonCard<T extends Session & PersonLocation>(person: T, sessions: T[], name: string): void {
    if (person.uuid == undefined || !person.playUri) return;
    analyticsClient.openWokaMenu();
    peopleCardReturn.tappedPerson(person.uuid);
    locatePerson(nearestSessionOnThisMap(sessions, person), name);
}
