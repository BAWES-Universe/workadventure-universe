<script lang="ts">
    import { getContext, hasContext } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import LL from "../../../../../i18n/i18n-svelte";
    import { ChatPermissionLevel } from "../../../Connection/ChatConnection";
    import type { MatrixChatRoomMember } from "../../../Connection/Matrix/MatrixChatRoomMember";
    import type { PictureStore } from "../../../../Stores/PictureStore";
    import {
        NAME_BY_CHAT_ID_CONTEXT,
        PERSON_COLOUR_CONTEXT,
        WOKA_BY_CHAT_ID_CONTEXT,
        personName,
        personPicture,
        type PersonColourOf,
    } from "../../../Stores/ChatUserWokaStore";
    import TopRowAvatar from "../../TopRow/TopRowAvatar.svelte";

    /** One person in a group's details: their woka and name, and their role when it is more than member. */
    export let member: MatrixChatRoomMember;
    export let isMe = false;

    const memberName = member.name;
    const permissionLevel = member.permissionLevel;
    const wokaByChatId: Readable<Map<string, PictureStore>> = hasContext(WOKA_BY_CHAT_ID_CONTEXT)
        ? getContext(WOKA_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, PictureStore>());
    const nameByChatId: Readable<Map<string, string>> = hasContext(NAME_BY_CHAT_ID_CONTEXT)
        ? getContext(NAME_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, string>());
    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);

    $: name = isMe ? $LL.chat.details.you() : personName($nameByChatId, member.id, $memberName);
    $: picture = personPicture($wokaByChatId, member.id, member.pictureStore);
    $: role =
        $permissionLevel === ChatPermissionLevel.ADMIN
            ? $LL.chat.manageRoomUsers.roles.ADMIN()
            : $permissionLevel === ChatPermissionLevel.MODERATOR
            ? $LL.chat.manageRoomUsers.roles.MODERATOR()
            : undefined;
</script>

<div class="flex min-h-[44px] items-center gap-3 px-2 py-1" data-testid="detailsMember">
    <TopRowAvatar pictureStore={picture} {name} color={$colourOf(member.id, name)} size="sm" ring={false} />
    <span class="min-w-0 flex-1 truncate text-sm text-white/90">{name}</span>
    {#if role}
        <span class="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">{role}</span
        >
    {/if}
</div>
