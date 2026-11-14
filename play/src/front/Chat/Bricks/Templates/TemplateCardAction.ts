import { get } from "svelte/store";
import LL from "../../../../i18n/i18n-svelte";
import { CardAnswers } from "../../../Components/ActionsMenu/cardAnswers";
import { wokaMenuStore } from "../../../Stores/WokaMenuStore";
import { readTemplateOfBrick } from "./Templates";
import { IconSparkles } from "@wa-icons";

/** What the card of a bot waits for before it shows its buttons: the template the bot shares, if any. */
export const TEMPLATE_ANSWER = "bot-template";

// The template a bot's card offers, kept for a few seconds like Summon's answer, so a template shared or stopped in Orbit
// shows the next time the card opens. Only a template shared with everyone is ever on a card (Orbit says so).
const templateAnswers = new CardAnswers((botId: string) => readTemplateOfBrick(botId));

/**
 * "Use template" on the card of a bot that shares one (game #2008): it opens the template's look before creating anything.
 * The card holds its buttons back until this is answered, so the button never appears late. A bot without one, or an answer
 * that could not be had, adds nothing: the card is as it was. `stillOpen` says whether the card is still the one that asked
 * (an answer that comes after it closed or turned to someone else adds nothing).
 */
export function addTemplateAction(userUuid: string, stillOpen: () => boolean): void {
    if (!userUuid.startsWith("bot-")) return;
    wokaMenuStore.expect(userUuid, TEMPLATE_ANSWER);
    void templateAnswers
        .get(userUuid.substring(4))
        .then((template) => {
            if (!template || !stillOpen() || get(wokaMenuStore)?.userUuid !== userUuid) return;
            const id = template.id;
            wokaMenuStore.addAction({
                actionName: get(LL).chat.brick.templates.use(),
                protected: false,
                priority: 0,
                style: "bg-white/10 hover:bg-white/30",
                actionIcon: IconSparkles,
                testId: "bot-use-template",
                // Loaded when it is used: the sheet needs the chat and the Bricks, which the card does not
                callback: () => {
                    import("./OpenTemplates")
                        .then(({ openTemplateSheet }) => openTemplateSheet(id))
                        .catch((error) => console.error("[Bot Extension] Could not open the template", error));
                },
            });
        })
        .catch((error) => console.warn("[Bot Extension] Could not read the template of a bot", error))
        .finally(() => {
            if (stillOpen()) wokaMenuStore.settle(userUuid, TEMPLATE_ANSWER);
        });
}
