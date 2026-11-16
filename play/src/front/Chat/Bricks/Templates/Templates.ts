import { botApiService } from "../../../external-modules/bots/services/BotApiService";
import { isRecord } from "./isRecord";
import {
    NO_CHOICES,
    parseMadeFromView,
    parseMakerTemplate,
    parseTemplateLists,
    parseTemplateLook,
    parseTemplateOfBrick,
    parseTemplatePreview,
    type MadeFromView,
    type MakerChoices,
    type MakerTemplate,
    type TemplateCard,
    type TemplateLists,
    type TemplateLook,
    type TemplatePreview,
    type UpdateField,
} from "./Template";

/**
 * What the template screens ask of Orbit (game #2008). Each call answers in the words the screen needs: a read that is
 * "not found" is said apart from one that failed, because "this template isn't shared any more" and "couldn't read it,
 * try again" are different things to tell a person.
 */

const statusOf = (error: unknown): number | undefined => (error as { status?: number } | null)?.status;

export type Read<T> = { ok: true; value: T } | { ok: false; why: "gone" | "failed" };

async function read<T>(ask: () => Promise<T | undefined>): Promise<Read<T>> {
    try {
        const value = await ask();
        return value === undefined ? { ok: false, why: "failed" } : { ok: true, value };
    } catch (error) {
        return { ok: false, why: statusOf(error) === 404 ? "gone" : "failed" };
    }
}

/** A template's look before creating a Brick from it. */
export function readTemplatePreview(templateId: string): Promise<Read<TemplatePreview>> {
    return read(async () => parseTemplatePreview(await botApiService.getTemplatePreview(templateId)));
}

/** The three short lists under "Start from a template". */
export function readTemplateLists(): Promise<Read<TemplateLists>> {
    return read(async () => {
        const answer = await botApiService.getTemplateLists();
        // Not a list at all (null, or an answer like { error }): that is a failed read with Try again, not three empty lists.
        // Orbit always sends all three lists, empty or not.
        const isList = isRecord(answer) && [answer.starred, answer.picks, answer.met].every(Array.isArray);
        return isList ? parseTemplateLists(answer) : undefined;
    });
}

/** Star keeps a template for later. False when Orbit refused or could not be reached. */
export async function setTemplateStar(templateId: string, starred: boolean): Promise<boolean> {
    try {
        await botApiService.starTemplate(templateId, starred);
        return true;
    } catch (error) {
        console.warn("Could not change the star of a template", error);
        return false;
    }
}

/**
 * The template on the card of a Brick someone meets: undefined when it shares none. When that could not be found out it
 * throws, so the card's answers are not kept (an answer that only meant Orbit did not say would hide the button for a while).
 */
export async function readTemplateOfBrick(botId: string): Promise<TemplateCard | undefined> {
    return parseTemplateOfBrick(await botApiService.getTemplateOfBrick(botId));
}

/* ------------------------------ sharing, for the Brick's owner ------------------------------ */

/** What goes in the request: the maker's choices, and nothing else (the rest is read from the Brick itself). */
export function choicesBody(choices: MakerChoices, audience?: string | null): Record<string, unknown> {
    return {
        leaveOutLook: choices.leaveOutLook,
        ...(choices.firstThing !== undefined ? { firstThing: choices.firstThing } : {}),
        optionalNeeds: choices.optionalNeeds,
        routines: choices.routines,
        ...(audience ? { audience } : {}),
    };
}

/** A Brick's "Template" group. */
export function readMakerTemplate(brickId: string): Promise<Read<MakerTemplate>> {
    return read(async () => parseMakerTemplate(await botApiService.getMakerTemplate(brickId)));
}

/** The look before sharing: exactly what would go with the template. Writes nothing. */
export function readTemplateLook(
    brickId: string,
    choices: MakerChoices = NO_CHOICES,
    audience?: string | null
): Promise<Read<TemplateLook>> {
    return read(async () =>
        parseTemplateLook(await botApiService.lookAtTemplate(brickId, choicesBody(choices, audience)))
    );
}

export type Shared =
    | { done: true; template: MakerTemplate }
    /** The Brick changed since the look was read: nothing was shared, and the look is read again. */
    | { done: false; why: "changed" }
    /** Something that looks like a secret is in it: nothing was shared until it is taken out. */
    | { done: false; why: "secret" }
    | { done: false; why: "gone" | "failed" };

/** "Share as a template" and "Share your latest changes": shares exactly the look the token names. */
export async function shareTemplateLook(
    brickId: string,
    look: TemplateLook,
    choices: MakerChoices,
    audience?: string | null
): Promise<Shared> {
    try {
        const template = parseMakerTemplate(
            await botApiService.shareTemplate(brickId, { ...choicesBody(choices, audience), token: look.token })
        );
        return template ? { done: true, template } : { done: false, why: "failed" };
    } catch (error) {
        const status = statusOf(error);
        const code = (error as { code?: string } | null)?.code;
        if (status === 409 && code === "changed") return { done: false, why: "changed" };
        if (status === 422 && code === "secret") return { done: false, why: "secret" };
        if (status === 404) return { done: false, why: "gone" };
        console.warn("Could not share a template", error);
        return { done: false, why: "failed" };
    }
}

/** "Stop sharing": nobody new can use it. */
export async function stopSharingTemplate(brickId: string): Promise<MakerTemplate | undefined> {
    try {
        return parseMakerTemplate(await botApiService.stopSharingTemplate(brickId));
    } catch (error) {
        console.warn("Could not stop sharing a template", error);
        return undefined;
    }
}

/* ------------------------------ a Brick made from a template ------------------------------ */

/** Where a Brick came from, what it still needs, and a template update waiting for review. Not-found for any other Brick. */
export function readMadeFrom(brickId: string): Promise<Read<MadeFromView>> {
    return read(async () => parseMadeFromView(await botApiService.getMadeFrom(brickId)));
}

export type Took =
    | { done: true; view: MadeFromView | undefined; routinesAdded: number; routinesLeftOut: number }
    /** The template changed again (or the offer is gone): the review is read again. */
    | { done: false; why: "changed" }
    | { done: false; why: "failed" };

/** "Template updated": the owner takes some parts, all or none. Taking none closes the offer for that version. */
export async function takeTemplateUpdate(brickId: string, version: number, take: UpdateField[]): Promise<Took> {
    try {
        const answer = (await botApiService.takeTemplateUpdate(brickId, version, take)) as {
            routines?: { added?: number; leftOut?: number };
        } | null;
        return {
            done: true,
            view: parseMadeFromView(answer),
            routinesAdded: typeof answer?.routines?.added === "number" ? answer.routines.added : 0,
            routinesLeftOut: typeof answer?.routines?.leftOut === "number" ? answer.routines.leftOut : 0,
        };
    } catch (error) {
        const status = statusOf(error);
        if (status === 409) return { done: false, why: "changed" };
        console.warn("Could not take a template update", error);
        return { done: false, why: "failed" };
    }
}
