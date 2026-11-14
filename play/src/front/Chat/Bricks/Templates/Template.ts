import { isRecord } from "./isRecord";

/**
 * Brick templates (game #2008), as Orbit sends them. A template starts a NEW Brick with its own identity and says what that
 * Brick still needs; it never carries memory, chats, apps, keys, sign-ins, a computer or running tasks. Everything here is
 * read defensively: a part that is not whole is left out, never guessed.
 */

/** A template as a row in a list or on a Brick's card: who made it and what it starts with. Never how many used it. */
export interface TemplateCard {
    id: string;
    /** The Brick it was shared from. */
    brickId: string;
    name: string;
    description: string | null;
    /** A Brick colour or a WOKA id; null when the maker left the look out. */
    look: string | null;
    firstThing: string | null;
    makerName: string;
    version: number;
    starred: boolean;
    /** The viewer made it. */
    mine: boolean;
}

/** What a Brick made from a template needs to do its main job: names only, never the way into anything. */
export interface TemplateNeed {
    kind: "app" | "computer";
    key: string;
    label: string;
    /** False when the maker says the main job works without it. */
    required: boolean;
    /** The person has it (before creating) or the Brick has it (after). Only said by Orbit when it knows. */
    ready: boolean;
}

/** A routine the maker added on purpose. It arrives switched off. */
export interface TemplateRoutine {
    kind: "reminder" | "schedule" | "watch";
    words: string;
    condition: string | null;
}

/** The look before creating: what the new Brick starts with, what stays with the original, what it still needs. */
export interface TemplatePreview extends TemplateCard {
    instructions: string | null;
    needs: TemplateNeed[];
    /** The main job lacks something: the person can still create it, knowing what is missing. */
    setupRequired: boolean;
    routines: TemplateRoutine[];
}

export interface TemplateLists {
    starred: TemplateCard[];
    picks: TemplateCard[];
    met: TemplateCard[];
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

export function parseTemplateCard(value: unknown): TemplateCard | undefined {
    if (!isRecord(value)) return undefined;
    const id = text(value.id);
    const name = text(value.name);
    if (!id || !name) return undefined;
    const maker = isRecord(value.maker) ? text(value.maker.name) : null;
    return {
        id,
        brickId: text(value.brickId) ?? "",
        name,
        description: text(value.description),
        look: text(value.look),
        firstThing: text(value.firstThing),
        makerName: maker ?? "",
        version: typeof value.version === "number" ? value.version : 1,
        starred: value.starred === true,
        mine: value.mine === true,
    };
}

export function parseTemplateCards(value: unknown): TemplateCard[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((one) => {
        const card = parseTemplateCard(one);
        return card ? [card] : [];
    });
}

export function parseTemplateLists(value: unknown): TemplateLists {
    const lists = isRecord(value) ? value : {};
    return {
        starred: parseTemplateCards(lists.starred),
        picks: parseTemplateCards(lists.picks),
        met: parseTemplateCards(lists.met),
    };
}

export function parseNeeds(value: unknown): TemplateNeed[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((one) => {
        if (!isRecord(one)) return [];
        const key = text(one.key);
        const label = text(one.label);
        if (!key || !label || (one.kind !== "app" && one.kind !== "computer")) return [];
        return [{ kind: one.kind, key, label, required: one.required !== false, ready: one.ready === true }];
    });
}

export function parseRoutines(value: unknown): TemplateRoutine[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((one) => {
        if (!isRecord(one)) return [];
        const words = text(one.words);
        if (!words || (one.kind !== "reminder" && one.kind !== "schedule" && one.kind !== "watch")) return [];
        return [{ kind: one.kind, words, condition: text(one.condition) }];
    });
}

/** The look before creating, as Orbit sends it (`{ template }`). Undefined when it is not whole or not there. */
export function parseTemplatePreview(value: unknown): TemplatePreview | undefined {
    const template = isRecord(value) ? value.template : undefined;
    const card = parseTemplateCard(template);
    if (!card || !isRecord(template)) return undefined;
    return {
        ...card,
        instructions: text(template.instructions),
        needs: parseNeeds(template.needs),
        setupRequired: template.setupRequired === true,
        routines: parseRoutines(template.routines),
    };
}

/** The template on a Brick's card (`{ template: card | null }`), when it has one. */
export function parseTemplateOfBrick(value: unknown): TemplateCard | undefined {
    return isRecord(value) ? parseTemplateCard(value.template) : undefined;
}

/** What the new Brick still lacks before it can do its main job. */
export function missingNeeds(needs: readonly TemplateNeed[]): TemplateNeed[] {
    return needs.filter((need) => need.required && !need.ready);
}

/** Words for a list of names: "Gmail", "Gmail and Notion", "Gmail, Notion and Slack". */
export function joinNames(names: readonly string[], and: string): string {
    if (names.length <= 1) return names[0] ?? "";
    return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

/* ------------------------------ the maker's side ------------------------------ */

export type FindingKind = "secret" | "detail";

/** Where the secret check found something, in words, with the first characters only. */
export interface TemplateFinding {
    kind: FindingKind;
    where: string;
    what: string;
    sample: string;
}

/** Exactly what would be shared: this is the look the maker reads before sharing. */
export interface TemplateLook {
    name: string;
    description: string | null;
    look: string | null;
    instructions: string | null;
    firstThing: string | null;
    needs: TemplateNeed[];
    routines: TemplateRoutine[];
    findings: TemplateFinding[];
    blocked: boolean;
    /** Sent back to share exactly this. */
    token: string;
}

export function parseTemplateLook(value: unknown): TemplateLook | undefined {
    const look = isRecord(value) && isRecord(value.look) ? value.look : isRecord(value) ? value : undefined;
    if (!look) return undefined;
    const name = text(look.name);
    const token = text(look.token);
    if (!name || !token) return undefined;
    const findings = Array.isArray(look.findings)
        ? look.findings.flatMap((one): TemplateFinding[] => {
              if (!isRecord(one)) return [];
              const where = text(one.where);
              const what = text(one.what);
              if (!where || !what || (one.kind !== "secret" && one.kind !== "detail")) return [];
              return [{ kind: one.kind, where, what, sample: typeof one.sample === "string" ? one.sample : "" }];
          })
        : [];
    return {
        name,
        description: text(look.description),
        look: text(look.look),
        instructions: text(look.instructions),
        firstThing: text(look.firstThing),
        needs: parseNeeds(look.needs),
        routines: parseRoutines(look.routines),
        findings,
        // A secret found always blocks, whatever the flag says
        blocked: look.blocked === true || findings.some((finding) => finding.kind === "secret"),
        token,
    };
}

/** A routine of the maker's own that can go along on purpose (Orbit names it by its id). */
export interface RoutineChoice extends TemplateRoutine {
    id: string;
}

/** A Brick's "Template" group, as Orbit sends it. */
export interface MakerTemplate {
    shared: boolean;
    /** Not shared now, but was: sharing again brings it back. */
    stopped: boolean;
    audience: "everyone" | "link" | null;
    version: number | null;
    /** How many Bricks were made from it. Only the number. */
    madeFrom: number;
    /** The Brick differs from what was last shared. */
    hasChanges: boolean;
    choices: MakerChoices;
    routineChoices: RoutineChoice[];
}

/** What the maker picks in the look. Everything else is read from the Brick itself. */
export interface MakerChoices {
    leaveOutLook: boolean;
    /** Undefined: the Brick's own first line. A string, empty or not, is the maker's own words. */
    firstThing?: string | null;
    optionalNeeds: string[];
    routines: string[];
}

export const NO_CHOICES: MakerChoices = { leaveOutLook: false, optionalNeeds: [], routines: [] };

export function parseMakerTemplate(value: unknown): MakerTemplate | undefined {
    const template = isRecord(value) ? value.template : undefined;
    if (!isRecord(template)) return undefined;
    const choices = isRecord(template.choices) ? template.choices : {};
    const strings = (list: unknown): string[] =>
        Array.isArray(list) ? list.filter((one): one is string => typeof one === "string" && one !== "") : [];
    const routineChoices = Array.isArray(template.routineChoices)
        ? template.routineChoices.flatMap((one): RoutineChoice[] => {
              if (!isRecord(one)) return [];
              const id = text(one.id);
              const [routine] = parseRoutines([one]);
              return id && routine ? [{ id, ...routine }] : [];
          })
        : [];
    return {
        shared: template.shared === true,
        stopped: template.stopped === true,
        audience: template.audience === "everyone" || template.audience === "link" ? template.audience : null,
        version: typeof template.version === "number" ? template.version : null,
        madeFrom: typeof template.madeFrom === "number" && template.madeFrom > 0 ? Math.floor(template.madeFrom) : 0,
        hasChanges: template.hasChanges === true,
        choices: {
            leaveOutLook: choices.leaveOutLook === true,
            ...("firstThing" in choices
                ? { firstThing: typeof choices.firstThing === "string" ? choices.firstThing : null }
                : {}),
            optionalNeeds: strings(choices.optionalNeeds),
            routines: strings(choices.routines),
        },
        routineChoices,
    };
}

/* ------------------------------ a Brick made from a template ------------------------------ */

export interface MadeFrom {
    templateName: string;
    makerName: string;
    version: number;
    /** The template is still shared. */
    shared: boolean;
}

export interface BrickSetup {
    needs: TemplateNeed[];
    /** The main job still lacks something. */
    setupRequired: boolean;
    /** Routines that came with it and are still switched off. */
    routinesOff: number;
}

export type UpdateField = "description" | "look" | "instructions" | "firstThing" | "routines";

/** One thing the maker changed that this Brick can take. */
export interface TemplateChange {
    field: UpdateField;
    /** What the Brick has now (text parts). */
    mine: string | null;
    /** What the template says now (text parts). */
    theirs: string | null;
    /** The routines the update adds (they arrive switched off). */
    routines: TemplateRoutine[];
}

export interface TemplateUpdate {
    version: number;
    changes: TemplateChange[];
}

export interface MadeFromView {
    madeFrom: MadeFrom;
    setup: BrickSetup;
    /** "Template updated": undefined when nothing new is offered. */
    update?: TemplateUpdate;
}

const UPDATE_FIELDS: readonly UpdateField[] = ["description", "look", "instructions", "firstThing", "routines"];

function parseSetup(value: unknown): BrickSetup {
    const setup = isRecord(value) ? value : {};
    const needs = parseNeeds(setup.needs);
    return {
        needs,
        setupRequired: setup.setupRequired === true,
        routinesOff: typeof setup.routinesOff === "number" && setup.routinesOff > 0 ? Math.floor(setup.routinesOff) : 0,
    };
}

function parseMadeFrom(value: unknown): MadeFrom | undefined {
    if (!isRecord(value)) return undefined;
    const templateName = text(value.templateName);
    if (!templateName) return undefined;
    const maker = isRecord(value.maker) ? text(value.maker.name) : null;
    return {
        templateName,
        makerName: maker ?? "",
        version: typeof value.version === "number" ? value.version : 1,
        shared: value.shared === true,
    };
}

function parseUpdate(value: unknown): TemplateUpdate | undefined {
    if (!isRecord(value) || !Array.isArray(value.changes) || typeof value.version !== "number") return undefined;
    const changes = value.changes.flatMap((one): TemplateChange[] => {
        if (!isRecord(one)) return [];
        const field = UPDATE_FIELDS.find((name) => name === one.field);
        if (!field) return [];
        if (field === "routines") {
            const routines = parseRoutines(one.theirs);
            return routines.length > 0 ? [{ field, mine: null, theirs: null, routines }] : [];
        }
        const theirs = text(one.theirs);
        return theirs ? [{ field, mine: text(one.mine), theirs, routines: [] }] : [];
    });
    return changes.length > 0 ? { version: value.version, changes } : undefined;
}

/** What a Brick page asks of Orbit (`{ madeFrom, setup, update }`): undefined for a Brick not made from a template. */
export function parseMadeFromView(value: unknown): MadeFromView | undefined {
    if (!isRecord(value)) return undefined;
    const madeFrom = parseMadeFrom(value.madeFrom);
    if (!madeFrom) return undefined;
    return { madeFrom, setup: parseSetup(value.setup), update: parseUpdate(value.update) };
}

/** What creating a Brick from a template answers: its card and where it came from. */
export interface UsedTemplate {
    brick: unknown;
    view: MadeFromView | undefined;
    /** How many routines came, switched off, and how many did not fit under the person's limit. */
    routinesAdded: number;
    routinesLeftOut: number;
}

export function parseUsedTemplate(value: unknown): UsedTemplate | undefined {
    if (!isRecord(value) || !isRecord(value.brick)) return undefined;
    const routines = isRecord(value.routines) ? value.routines : {};
    return {
        brick: value.brick,
        view: parseMadeFromView(value),
        routinesAdded: typeof routines.added === "number" ? routines.added : 0,
        routinesLeftOut: typeof routines.leftOut === "number" ? routines.leftOut : 0,
    };
}
