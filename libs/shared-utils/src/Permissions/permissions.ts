/**
 * What a person may do in a world, as Orbit's roles define it. Orbit sends one number per person (a sum of bits, as a
 * decimal string). The bit numbers are fixed forever: never reuse one.
 */
export const Permission = {
    GIVE_ROLES: 0,
    MANAGE_ROLES: 1,
    INVITE_AND_REMOVE: 2,
    BAN_AND_APPEALS: 3,
    KICK_FROM_ROOM: 4,
    MANAGE_WORLDS: 5,
    MANAGE_ROOMS: 6,
    EDIT_MAPS: 7,
    GO_LIVE: 8,
    SEND_MESSAGES: 9,
    REACH_UNIVERSE: 10,
    MODERATE_CALLS: 11,
    MODERATE_AREA_CHATS: 12,
    MANAGE_BOTS: 13,
    ADMINISTRATOR: 30,
} as const;

export type PermissionBit = (typeof Permission)[keyof typeof Permission];

// What the "admin" and "editor" tags stand for when Orbit sends no number (an Orbit from before roles): the same
// numbers as the built-in roles of the same name.
const ADMIN_TAG_PERMISSIONS = 16383;
const EDITOR_TAG_PERMISSIONS = 8416;
// Administrator holds every permission: all the bits up to and including its own.
const EVERY_PERMISSION = 2 ** 31 - 1;

/*
 * Plain numbers, not bigint: the front is built for browsers without bigint literals (Safari 12) and old iOS has no
 * BigInt at all. Up to 15 digits is an exact whole number in JavaScript, far past the highest bit used.
 */

/**
 * The permissions of a person, from the number Orbit sent. Without a usable number (none sent, or something that is not
 * a whole number) it falls back to the tags, so the game keeps working with an Orbit that does not send roles yet.
 */
export function permissionsFrom(permissions: string | undefined, tags: string[]): number {
    if (permissions !== undefined && /^\d{1,15}$/.test(permissions)) {
        const parsed = Number(permissions);
        return hasPermission(parsed, Permission.ADMINISTRATOR) ? EVERY_PERMISSION : parsed;
    }
    let fromTags = 0;
    if (tags.includes("admin")) fromTags |= ADMIN_TAG_PERMISSIONS;
    if (tags.includes("editor")) fromTags |= EDITOR_TAG_PERMISSIONS;
    return fromTags;
}

function bitIsSet(permissions: number, bit: number): boolean {
    // Division, not `&`: bitwise operators cut numbers to 32 bits
    return Math.floor(permissions / 2 ** bit) % 2 === 1;
}

export function hasPermission(permissions: number, bit: PermissionBit): boolean {
    return bitIsSet(permissions, bit) || bitIsSet(permissions, Permission.ADMINISTRATOR);
}
