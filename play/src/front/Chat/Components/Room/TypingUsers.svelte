<script lang="ts">
    import { getContext, hasContext } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import TopRowAvatar from "../TopRow/TopRowAvatar.svelte";
    import type { PictureStore } from "../../../Stores/PictureStore";
    import {
        NAME_BY_CHAT_ID_CONTEXT,
        PERSON_COLOUR_CONTEXT,
        WOKA_BY_CHAT_ID_CONTEXT,
        personName,
        personPicture,
    } from "../../Stores/ChatUserWokaStore";
    import type { PersonColourOf } from "../../Stores/ChatUserWokaStore";
    import { formatPeopleNames } from "../TopRow/TopRowSummary";
    import LL from "../../../../i18n/i18n-svelte";

    export let typingMembers: { id: string; name: string | null; pictureStore: PictureStore }[];
    const NUMBER_OF_TYPING_MEMBER_TO_DISPLAY = 3;

    // Typing people show the same woka, on the same colour, and the same name as next to their messages and in the header.
    const wokaByChatId: Readable<Map<string, PictureStore>> = hasContext(WOKA_BY_CHAT_ID_CONTEXT)
        ? getContext(WOKA_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, PictureStore>());
    const nameByChatId: Readable<Map<string, string>> = hasContext(NAME_BY_CHAT_ID_CONTEXT)
        ? getContext(NAME_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, string>());
    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);

    // While the dots fade out, they still show who was typing.
    let shownMembers = typingMembers;
    $: if (typingMembers.length > 0) shownMembers = typingMembers;
    $: visible = typingMembers.length > 0;

    function nameOf(namesByChatId: Map<string, string>, member: { id: string; name: string | null }): string {
        return personName(namesByChatId, member.id, member.name ?? "");
    }
    // The same name in a direct message and in a group: "Sara", "Sara & Omar", "Sara, Omar +2".
    $: names = formatPeopleNames(
        shownMembers.map((member) => nameOf($nameByChatId, member) || $LL.chat.topRow.someone()),
        { two: $LL.chat.topRow.twoNames, more: $LL.chat.topRow.moreNames }
    );
</script>

<!-- Rests on the top edge of the message box, or of the reply above it (#1379). It floats over the messages and takes
     no room, so nothing in the chat moves when it shows. -->
<div class="typing-users" class:visible data-typing aria-hidden={!visible} data-testid="typingUsers">
    <div class="avatars flex items-center">
        {#each shownMembers.slice(0, NUMBER_OF_TYPING_MEMBER_TO_DISPLAY) as typingMember, index (typingMember.id)}
            <div id={`typing-user-${typingMember.id}`} class={index > 0 ? "-ml-1.5" : ""}>
                <TopRowAvatar
                    pictureStore={personPicture($wokaByChatId, typingMember.id, typingMember.pictureStore)}
                    name={nameOf($nameByChatId, typingMember) || "Unknown"}
                    color={$colourOf(typingMember.id, typingMember.name ?? undefined)}
                    size="xs"
                    ring={shownMembers.length > 1}
                />
            </div>
        {/each}
    </div>
    <span class="names">{names}</span>
    <span class="dots" aria-hidden="true"><span /><span /><span /></span>
</div>

<style>
    .typing-users {
        position: relative;
        z-index: 1;
        align-self: flex-start;
        /* Half its height over the edge below: the field's (8px of padding) or the reply's (8px of gap). */
        margin: 0 0 calc(-0.5rem - 0.8125rem) 0.25rem;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 0.375rem;
        max-width: calc(100% - 1rem);
        height: 1.625rem;
        padding: 0 0.625rem 0 0.25rem;
        border-radius: 9999px;
        background: rgb(28 24 38);
        border: 1px solid rgb(255 255 255 / 0.1);
        box-shadow: 0 4px 12px rgb(0 0 0 / 0.35);
        color: rgb(255 255 255 / 0.75);
        font-size: 0.75rem;
        line-height: 1;
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px);
        /* Hidden for real once faded out, so it counts as gone (screen readers, tests). */
        visibility: hidden;
        transition: opacity 0.2s ease, transform 0.2s ease, visibility 0s linear 0.2s;
    }

    .typing-users.visible {
        opacity: 1;
        transform: none;
        /* Not "visible": the dots hide with the conversation while a profile or details page is open (#1672). */
        visibility: inherit;
        transition: opacity 0.2s ease, transform 0.2s ease, visibility 0s;
    }

    /* Smaller than next to messages: the pill sits on the message box's edge. */
    .avatars :global(.top-row-avatar) {
        width: 1.25rem;
        height: 1.25rem;
    }

    .names {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .dots {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: 2px;
    }

    .dots span {
        width: 4px;
        height: 4px;
        border-radius: 9999px;
        background: rgb(255 255 255 / 0.85);
        animation: bounce 1s infinite;
    }

    .dots span:nth-child(2) {
        animation-delay: 0.12s;
    }

    .dots span:nth-child(3) {
        animation-delay: 0.24s;
    }

    @keyframes bounce {
        0%,
        100% {
            transform: translateY(0);
        }
        50% {
            transform: translateY(-3px);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .typing-users,
        .typing-users.visible {
            transition: none;
        }

        .dots span {
            animation: none;
        }
    }
</style>
