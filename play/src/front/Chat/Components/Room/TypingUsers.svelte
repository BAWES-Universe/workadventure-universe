<script lang="ts">
    import { getContext, hasContext } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import TopRowAvatar from "../TopRow/TopRowAvatar.svelte";
    import type { PictureStore } from "../../../Stores/PictureStore";
    import { PERSON_COLOUR_CONTEXT, WOKA_BY_CHAT_ID_CONTEXT, personPicture } from "../../Stores/ChatUserWokaStore";
    import type { PersonColourOf } from "../../Stores/ChatUserWokaStore";

    export let typingMembers: { id: string; name: string | null; pictureStore: PictureStore }[];
    const NUMBER_OF_TYPING_MEMBER_TO_DISPLAY = 3;

    // Typing people show the same woka, on the same colour, as next to their messages and in the header.
    const wokaByChatId: Readable<Map<string, PictureStore>> = hasContext(WOKA_BY_CHAT_ID_CONTEXT)
        ? getContext(WOKA_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, PictureStore>());
    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);
</script>

<div class="flex row w-full text-gray-300 text-sm m-0 px-2 mb-2">
    {#each typingMembers
        .map((typingMember, index) => ({ ...typingMember, index }))
        .slice(0, NUMBER_OF_TYPING_MEMBER_TO_DISPLAY) as typingMember (typingMember.id)}
        {#if typingMember}
            <div id={`typing-user-${typingMember.id}`} class="-ml-2">
                <TopRowAvatar
                    pictureStore={personPicture($wokaByChatId, typingMember.id, typingMember.pictureStore)}
                    name={typingMember.name ?? "Unknown"}
                    color={$colourOf(typingMember.id, typingMember.name ?? undefined)}
                    size="xs"
                    ring={typingMembers.length > 1}
                />
            </div>
        {/if}
    {/each}

    {#if typingMembers.length > NUMBER_OF_TYPING_MEMBER_TO_DISPLAY}
        <div class="rounded-full h-6 w-6 text-center uppercase text-white bg-gray-400 -ml-1 chatAvatar">
            +{typingMembers.length - NUMBER_OF_TYPING_MEMBER_TO_DISPLAY}
        </div>
    {/if}
    <div class="message rounded-2xl px-3 rounded-bl-none bg-contrast flex text-lg ml-1">
        <div class="animate-bounce-1">.</div>
        <div class="animate-bounce-2">.</div>
        <div class="animate-bounce-3">.</div>
    </div>
</div>

<style>
    @keyframes bounce {
        0%,
        100% {
            transform: translateY(0);
        }
        50% {
            transform: translateY(-25%);
        }
    }

    .animate-bounce-1 {
        animation: bounce 1s infinite;
    }

    .animate-bounce-2 {
        animation: bounce 1s infinite 0.1s;
    }

    .animate-bounce-3 {
        animation: bounce 1s infinite 0.2s;
    }

    .message {
        min-width: 0;
        overflow-wrap: anywhere;
        position: relative;
    }

    .chatAvatar {
        border-style: solid;
        border-color: rgb(27 42 65 / 0.95);
        border-width: 1px;
    }
</style>
