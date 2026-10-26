import { readable, type Readable } from "svelte/store";
import type { BotRoomLink } from "../../../Bots/BotRoomLink";
import { goToPersonRoom } from "../../UserList/PersonNavigation";
import type { DirectPartner } from "./DirectPartnerStore";
import { walkToPartner } from "./PartnerActions";

const NAME_MAX = 120;

function pathOf(address: string): string | undefined {
    try {
        return decodeURIComponent(new URL(address).pathname).replace(/\/+$/, "");
    } catch {
        return undefined;
    }
}

/** Whether two room addresses are the same room, however each spells its path. */
export function sameRoom(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return false;
    const path = pathOf(a);
    return path !== undefined && path === pathOf(b);
}

const nameOf = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, NAME_MAX) : "");

/**
 * Where a person is now, from Orbit's live view: the room they went to last. Undefined when the view leaves them out,
 * which it does for anyone who doesn't share their room with you and for rooms you can't enter.
 */
export function personNowIn(view: unknown, uuid: string, gameOrigin: string): BotRoomLink | undefined {
    const people = (view as { people?: unknown } | null)?.people;
    if (!Array.isArray(people)) return undefined;
    const person = people.find(
        (entry: { uuid?: unknown; you?: unknown }) => entry?.uuid === uuid && entry.you !== true
    ) as { place?: Record<string, unknown> } | undefined;
    const place = person?.place;
    const playPath = place?.playPath;
    const room = nameOf(place?.name);
    if (typeof playPath !== "string" || !playPath.startsWith("/@/") || !room) return undefined;
    return {
        url: new URL(playPath, gameOrigin).toString(),
        room,
        world: nameOf((place?.world as { name?: unknown } | undefined)?.name),
        universe: nameOf((place?.universe as { name?: unknown } | undefined)?.name),
    };
}

/** A person's room for their profile, asked of Orbit once while the profile is open. */
export function partnerNowIn(
    uuid: string | undefined,
    ask: () => Promise<unknown>,
    gameOrigin: string
): Readable<BotRoomLink | undefined> {
    if (!uuid) return readable(undefined);
    return readable<BotRoomLink | undefined>(undefined, (set) => {
        let open = true;
        ask()
            .then((view) => {
                if (open) set(personNowIn(view, uuid, gameOrigin));
            })
            .catch((error) => console.error("Failed to read where they are", error));
        return () => {
            open = false;
        };
    });
}

/** Visit a person: walk to them while they're in this world, else go to their room and to them there. */
export function visitPerson(partner: DirectPartner, link: BotRoomLink): void {
    if (partner.actions.walkTo) walkToPartner(partner);
    else goToPersonRoom({ uuid: partner.uuid, playUri: link.url });
}
