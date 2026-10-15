import { writable } from "svelte/store";
import type { InstallAccount } from "./InstallApp";

/** A room was joined, with the player variables of this account. */
export interface InstallRoomJoined {
    variables: ReadonlyMap<string, unknown>;
    account: InstallAccount;
}

/**
 * The game scene says here that a room was joined; the install wiring listens (see startInstallApp). A store, so the
 * game scene does not import the install wiring and the many stores it reads, which would import the scene back.
 */
export const installRoomJoinedStore = writable<InstallRoomJoined | undefined>(undefined);
