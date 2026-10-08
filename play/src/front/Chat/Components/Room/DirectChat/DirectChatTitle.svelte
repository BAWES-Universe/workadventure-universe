<script lang="ts">
    import { createEventDispatcher, getContext, hasContext } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import LL from "../../../../../i18n/i18n-svelte";
    import type { ChatRoom } from "../../../Connection/ChatConnection";
    import type { PictureStore } from "../../../../Stores/PictureStore";
    import { PERSON_COLOUR_CONTEXT, WOKA_BY_CHAT_ID_CONTEXT, personPicture } from "../../../Stores/ChatUserWokaStore";
    import type { PersonColourOf } from "../../../Stores/ChatUserWokaStore";
    import TopRowAvatar from "../../TopRow/TopRowAvatar.svelte";
    import type { DirectPartner } from "./DirectPartnerStore";
    import { isInUniverse } from "./PartnerPlace";
    import { partnerStatus } from "./PartnerStatus";
    import { IconLock } from "@wa-icons";

    /**
     * Header title of a direct chat, laid out like every other chat: their woka (ringed while they're in Universe),
     * their name, and where they are right now. Tapping it opens their profile.
     */
    export let room: ChatRoom;
    export let partner: DirectPartner;

    const dispatch = createEventDispatcher<{ openProfile: void }>();
    const roomName = room.name;
    const isEncrypted = room.isEncrypted;
    const wokaByChatId: Readable<Map<string, PictureStore>> = hasContext(WOKA_BY_CHAT_ID_CONTEXT)
        ? getContext(WOKA_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, PictureStore>());
    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);

    $: picture = personPicture($wokaByChatId, partner.chatId, undefined) ?? room.pictureStore;
    $: status = partnerStatus(partner.place, $LL);
    $: live = isInUniverse(partner.place);
</script>

<button
    type="button"
    class="m-0 flex min-w-0 max-w-full items-center gap-2.5 rounded-xl py-1 pe-2 ps-1 text-start text-white [font:inherit] hover:bg-white/10"
    aria-label={$LL.chat.directChat.openProfile({ name: $roomName })}
    data-testid="openPartnerProfile"
    on:click={() => dispatch("openProfile")}
>
    <span class="relative flex shrink-0" aria-hidden="true">
        <TopRowAvatar
            pictureStore={picture}
            name={$roomName}
            color={$colourOf(partner.chatId, $roomName)}
            ring={false}
        />
        {#if live}
            <span
                class="absolute -inset-1 rounded-full border-2 border-solid"
                style:border-color={status.color}
                data-testid="partnerLiveRing"
            />
        {/if}
    </span>
    <span class="flex min-w-0 flex-col">
        <span class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-md font-bold leading-5" data-testid="roomName">{$roomName}</span>
            {#if $isEncrypted}
                <span
                    class="shrink-0 text-white/50"
                    title={$LL.chat.thread.encrypted()}
                    data-testid="threadEncryptedLock"
                >
                    <IconLock font-size="14" />
                </span>
            {/if}
        </span>
        <span class="flex min-w-0 items-center gap-1.5 text-xs text-white/60" data-testid="partnerStatus">
            <span
                class="h-1.5 w-1.5 shrink-0 rounded-full"
                style:background-color={status.color ?? "rgb(255 255 255 / 0.35)"}
            />
            <span class="truncate">{status.label}</span>
        </span>
    </span>
</button>
