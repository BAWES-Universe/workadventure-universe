import { writable } from "svelte/store";

/** What Orbit calls one role: the tag carried by people, its name and colour, and whether it may show on other people. */
export type RoleLabel = {
    key: string;
    name: string;
    color: string;
    visibleOnOthers: boolean;
};

/**
 * The roles Orbit named to this player when they joined, highest first. `undefined` until then, and for worlds whose
 * admin sends no list (nothing is shown beyond the old Admin badge there).
 */
export const worldRolesStore = writable<RoleLabel[] | undefined>(undefined);

/** Member's dot in a person's roles list: Orbit's colour for Member, which it never names to the game. */
export const MEMBER_COLOR = "#A78BFA";

/** A role a person holds, as Orbit named it. */
export type HeldRole = RoleLabel;

/**
 * The roles in a person's tags that Orbit named, highest first (the list's order). Member is automatic and never listed.
 * Whether to show one is up to the screen: see rolesToShow.
 */
export function resolveRoles(
    tags: readonly string[] | undefined,
    catalogue: readonly RoleLabel[] | undefined
): HeldRole[] {
    if (!tags || !catalogue) return [];
    return catalogue.filter((role) => tags.includes(role.key));
}

/** The roles to show next to a person: a role whose badge is hidden on others only shows on the player themself. */
export function rolesToShow(roles: readonly HeldRole[] | undefined, isMe: boolean): HeldRole[] {
    return (roles ?? []).filter((role) => role.visibleOnOthers || isMe);
}
