import type { MembershipButton } from "../../external-modules/bots/services/BotApiService";
import type { WokaMenuAction } from "../../Stores/WokaMenuStore";

export interface MembershipCardButtonDeps {
    userUuid: string;
    /** Asks Orbit what the button says for this person; null when there is none or Orbit did not answer. */
    ask: (userUuid: string) => Promise<MembershipButton | null>;
    /** This person's card is still the one showing. */
    stillShown: () => boolean;
    add: (action: WokaMenuAction) => void;
    open: (userUuid: string) => void;
    icons: Record<MembershipButton["kind"], WokaMenuAction["actionIcon"]>;
}

/**
 * The membership button on a person's card (Give membership, Pending invite, Roles or Membership, as Orbit names it),
 * added when Orbit answers. Nothing is added when there is no button, when Orbit did not answer, or when the card
 * closed or turned to someone else while it was asked.
 */
export async function addMembershipCardButton(deps: MembershipCardButtonDeps): Promise<boolean> {
    const button = await deps.ask(deps.userUuid);
    if (!button || !deps.stillShown()) return false;
    deps.add({
        actionName: button.label,
        protected: false,
        priority: -0.1,
        style: "bg-white/10 hover:bg-white/30",
        testId: "wokamenu-membership-button",
        callback: () => deps.open(deps.userUuid),
        actionIcon: deps.icons[button.kind],
    });
    return true;
}
