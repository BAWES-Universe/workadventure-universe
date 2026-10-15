<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { IconCheck, IconCopy, IconShare, IconX } from "@wa-icons";

    /**
     * The invite card: the link to this room, one-tap copy or share, and two options (arrive next to me, pick an
     * entry point). Same link rules as the menu's invite page. One card for every button that opens it: chat's
     * "Invite someone to join" (InviteFooter.svelte) and the one in the installed app's title bar (TitleBar.svelte).
     * It is built each time it opens, so the link is where you stand now; the one showing it closes it on "close".
     */
    /** Distinguishes the title's id when two cards could ever be on one page. */
    export let titleId = "chatInviteTitle";

    const dispatch = createEventDispatcher<{ close: void }>();
    const COPIED_FOR_MS = 3000;

    // No scene while a reconnect swaps it: the link still works, without entry points or "next to me".
    const gameScene = gameManager.tryGetCurrentGameScene();
    const startPositions = gameScene?.getStartPositionNames() ?? [];
    const canShare = typeof navigator.share === "function";
    const roomName = gameScene?.room.roomName?.trim();

    let arriveNextToMe = false;
    let entryPoint = startPositions[0] ?? "";
    let copied = false;
    let copiedTimer: ReturnType<typeof setTimeout> | undefined;
    let linkField: HTMLInputElement | undefined;

    function playerPosition(): { x: number; y: number } | undefined {
        const player = gameManager.tryGetCurrentGameScene()?.CurrentPlayer;
        return player ? { x: Math.floor(player.x), y: Math.floor(player.y) } : undefined;
    }

    function buildLink(): string {
        const base = `${location.origin}${location.pathname}`;
        const hash: string[] = [];
        if (entryPoint && startPositions.length > 1) hash.push(entryPoint);
        const position = arriveNextToMe ? playerPosition() : undefined;
        if (position) hash.push(`moveTo=${position.x},${position.y}`);
        return hash.length > 0 ? `${base}#${hash.join("&")}` : base;
    }

    let link = "";
    // Rebuilt whenever an option changes.
    $: link = linkFor(arriveNextToMe, entryPoint);

    function linkFor(_nextToMe: boolean, _entry: string): string {
        return buildLink();
    }

    onMount(() => {
        analyticsClient.openInvite();
        linkField?.select();
    });

    function copy() {
        analyticsClient.inviteCopyLink();
        if (arriveNextToMe) analyticsClient.inviteCopyLinkWalk(link);
        navigator.clipboard
            .writeText(link)
            .then(() => {
                copied = true;
                if (copiedTimer) clearTimeout(copiedTimer);
                copiedTimer = setTimeout(() => (copied = false), COPIED_FOR_MS);
            })
            .catch((error) => {
                console.error("Could not copy the invite link", error);
                linkField?.select();
            });
    }

    function share() {
        analyticsClient.inviteCopyLink();
        navigator.share({ url: link }).catch((error: unknown) => {
            // Closing the share sheet is not a failure: only copy when sharing really could not happen.
            if (error instanceof DOMException && error.name === "AbortError") return;
            copy();
        });
    }

    onDestroy(() => {
        if (copiedTimer) clearTimeout(copiedTimer);
    });
</script>

<section class="u-glass invite-card rounded-2xl p-3" aria-labelledby={titleId} data-testid="chatInviteCard">
    <div class="flex items-start gap-2">
        <div class="flex min-w-0 grow flex-col">
            <h3 id={titleId} class="u-text-gradient m-0 text-base font-bold leading-6">
                {$LL.chat.inviteFooter.title()}
            </h3>
            <p class="m-0 text-xs leading-5 text-white/60">
                {roomName ? $LL.chat.inviteFooter.hintRoom({ room: roomName }) : $LL.chat.inviteFooter.hint()}
            </p>
        </div>
        <button
            type="button"
            class="m-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg p-0 text-white/60 hover:bg-white/10 hover:text-white"
            aria-label={$LL.chat.inviteFooter.close()}
            on:click={() => dispatch("close")}
        >
            <IconX font-size="16" />
        </button>
    </div>

    <div class="invite-link mt-3 flex items-center gap-1 rounded-xl p-1 ps-3">
        <input
            bind:this={linkField}
            type="text"
            readonly
            class="m-0 min-w-0 grow border-none bg-transparent p-0 text-xs text-white/80 focus:outline-none focus:ring-0"
            value={link}
            aria-label={$LL.chat.inviteFooter.linkLabel()}
            data-testid="chatInviteLink"
            on:focus={() => linkField?.select()}
        />
        <button
            type="button"
            class="u-cta m-0 flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold"
            data-testid="chatInviteCopy"
            on:click={copy}
        >
            {#if copied}
                <IconCheck font-size="16" />
                {$LL.menu.invite.copied()}
            {:else}
                <IconCopy font-size="16" />
                {$LL.menu.invite.copy()}
            {/if}
        </button>
    </div>

    {#if canShare}
        <button
            type="button"
            class="u-cta-secondary m-0 mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold"
            data-testid="chatInviteShare"
            on:click={share}
        >
            <IconShare font-size="18" />
            {$LL.chat.inviteFooter.share()}
        </button>
    {/if}

    <label class="invite-option mt-3 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2">
        <input
            type="checkbox"
            class="invite-switch m-0 shrink-0"
            bind:checked={arriveNextToMe}
            data-testid="chatInviteNextToMe"
        />
        <span class="flex min-w-0 flex-col">
            <span class="text-sm font-semibold text-white">{$LL.chat.inviteFooter.nextToMe()}</span>
            <span class="text-xs text-white/55">{$LL.chat.inviteFooter.nextToMeHint()}</span>
        </span>
    </label>

    {#if startPositions.length > 1}
        <label class="invite-option mt-2 flex items-center gap-3 rounded-xl px-3 py-2">
            <span class="grow text-sm font-semibold text-white">{$LL.chat.inviteFooter.entryPoint()}</span>
            <select
                bind:value={entryPoint}
                class="m-0 max-w-[50%] rounded-lg border border-solid border-white/15 bg-contrast/80 px-2 py-1 text-xs text-white"
                data-testid="chatInviteEntryPoint"
            >
                {#each startPositions as name (name)}
                    <option value={name}>{name}</option>
                {/each}
            </select>
        </label>
    {/if}
</section>

<style>
    .invite-card {
        box-shadow: 0 18px 40px -16px rgb(0 0 0 / 0.6);
    }

    .invite-link {
        background: rgb(0 0 0 / 0.25);
        border: 1px solid rgb(255 255 255 / 0.08);
    }

    .invite-option {
        background: rgb(255 255 255 / 0.04);
        transition: background-color 150ms ease;
    }
    .invite-option:hover {
        background: rgb(255 255 255 / 0.08);
    }

    /* A small brand switch for the checkbox. */
    .invite-switch {
        appearance: none;
        -webkit-appearance: none;
        position: relative;
        width: 2.25rem;
        height: 1.25rem;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.15);
        cursor: pointer;
        transition: background 200ms ease;
    }
    .invite-switch::after {
        content: "";
        position: absolute;
        top: 2px;
        inset-inline-start: 2px;
        width: 1rem;
        height: 1rem;
        border-radius: 999px;
        background: #fff;
        transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .invite-switch:checked {
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .invite-switch:checked::after {
        transform: translateX(1rem);
    }
    :global([dir="rtl"]) .invite-switch:checked::after {
        transform: translateX(-1rem);
    }
    .invite-switch:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
</style>
