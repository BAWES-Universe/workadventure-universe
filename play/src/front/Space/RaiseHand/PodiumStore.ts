import { derived, writable } from "svelte/store";
import { userIsAdminStore } from "../../Stores/GameStore";
import { isSpeakerStore } from "../../Stores/MediaStore";

/**
 * On a podium: the speaker (or an admin) invites someone from the audience to speak, the invited person accepts and
 * streams to the audience, and either side ends it.
 */

/** Who may invite to speak and move people back to the audience. */
export const canInviteToSpeakStore = derived(
    [isSpeakerStore, userIsAdminStore],
    ([$isSpeaker, $isAdmin]) => $isSpeaker || $isAdmin
);

/** An invitation waiting for our answer. */
export const speakInvitationStore = writable<{ fromName: string; accept: () => void; decline: () => void } | undefined>(
    undefined
);

/** While we speak from the audience: how to stop. */
export const speakingFromAudienceStore = writable<{ stop: () => void } | undefined>(undefined);

/** The people we invited and who have not answered yet, by uuid. */
export const pendingInvitesStore = writable<ReadonlySet<string>>(new Set());
