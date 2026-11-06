<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gridColumns, type CardAction, type CardRelation, type CardRole, type CardStatus } from "./personCardModel";
    import { IconBan, IconDots, IconUserCheck, IconClock } from "@wa-icons";

    /**
     * The card for a player or a bot (#1790): who they are on top (Woka, name, status, role, friend), what they wrote
     * in the middle, and every button in one grid of equal tiles at the bottom, so none is left alone on a row. The
     * grid waits until every answer is in (Orbit's membership, a bot's Message and Summon), so no button moves the
     * others once it shows.
     */
    export let name: string;
    /** The Woka, as a sprite sheet (96x128, front frame shown). The game puts its own Woka in the "woka" slot. */
    export let wokaSheet: string | undefined = undefined;
    /** A bot's mood emoji, beside its Woka (#1667), or what it is busy with. */
    export let mood: string | undefined = undefined;
    export let status: CardStatus | undefined = undefined;
    export let roles: CardRole[] = [];
    export let relation: CardRelation | undefined = undefined;
    export let blocked = false;
    /** The card's own answers aren't in yet: the body and the buttons wait in place. */
    export let loading = false;
    /** Searching for someone far away: a line instead of the buttons. */
    export let progress: string | undefined = undefined;
    export let actions: CardAction[] = [];
    export let more: CardAction[] = [];
    export let moreOpen = false;
    export let phone = false;

    const dispatch = createEventDispatcher<{ select: string; close: void; more: void }>();

    $: tiles = (
        more.length > 0 ? [...actions, { id: "more", label: $LL.chat.personCard.more(), icon: IconDots }] : actions
    ) as CardAction[];
    // Four to a row; five or six split evenly (3 + 2, 3 + 3) so the last row never holds one button.
    $: columns = gridColumns(tiles.length);
    const skeletons = Array.from({ length: 4 });

    function relationLabel(value: CardRelation): string {
        if (value === "friend") return $LL.chat.friends.friendBadge();
        if (value === "requestSent") return $LL.chat.friends.requestSent();
        return $LL.chat.personCard.wantsToBeFriends();
    }

    function press(tile: CardAction) {
        if (tile.id === "more") dispatch("more");
        else dispatch("select", tile.id);
    }
</script>

<div class="person-card u-surface" class:phone data-testid="actions-menu">
    <button class="u-close close" type="button" aria-label={$LL.actionbar.close()} on:click={() => dispatch("close")}>
        <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg
        >
    </button>

    <div class="scroll">
        <header class="who">
            <div class="woka" id="woka" aria-hidden="true">
                <slot name="woka">
                    {#if wokaSheet}
                        <span class="sprite" style:background-image="url('{wokaSheet}')" />
                    {:else}
                        <span class="sprite placeholder" />
                    {/if}
                </slot>
                {#if mood}
                    <span class="mood">{mood}</span>
                {/if}
            </div>
            <div class="names">
                <h3 class="name">{name}</h3>
                {#if status}
                    <p class="status">
                        {#if status.colour}<i class="dot" style:background={status.colour} />{/if}
                        <span>{status.label}</span>
                    </p>
                {/if}
                {#if roles.length > 0 || relation || blocked}
                    <div class="badges">
                        <!-- Every role, not "+N": the card has the room, and nothing about them waits behind a tap. -->
                        {#each roles as role (role.name)}
                            <span class="pill"><i class="dot" style:background={role.color} />{role.name}</span>
                        {/each}
                        {#if relation}
                            <span class="friend">
                                {#if relation === "requestSent"}<IconClock />{:else}<IconUserCheck />{/if}
                                {relationLabel(relation)}
                            </span>
                        {/if}
                        {#if blocked}
                            <span class="blocked"><IconBan />{$LL.chat.personCard.blocked()}</span>
                        {/if}
                    </div>
                {/if}
            </div>
        </header>

        {#if loading}
            <div class="body-wait" aria-hidden="true"><i /><i /><i class="short" /></div>
        {/if}
        <!-- Kept in place while the answers come in, so what it holds (a profile) loads meanwhile. -->
        <div class="body" class:wait={loading}><slot /></div>
    </div>

    {#if progress}
        <p class="progress"><span class="bar"><i /></span>{progress}</p>
    {:else if loading}
        <div class="grid" style:--cols={4} aria-hidden="true">
            {#each skeletons as _, i (i)}<span class="tile wait" />{/each}
        </div>
    {:else if tiles.length > 0}
        <div class="grid" style:--cols={columns}>
            {#each tiles as tile (tile.id)}
                <button
                    type="button"
                    class="tile"
                    data-testid={tile.id === "more" ? "wokamenu-more-button" : tile.testId}
                    on:click|preventDefault={() => press(tile)}
                    class:go={tile.tone === "go"}
                    class:open={tile.id === "more" && moreOpen}
                    aria-expanded={tile.id === "more" ? moreOpen : undefined}
                >
                    {#if tile.icon}<svelte:component this={tile.icon} class="tile-icon" />{:else if tile.iconSrc}<img
                            src={tile.iconSrc}
                            class="tile-icon"
                            alt=""
                        />{/if}
                    <span class="tile-label">{tile.label}</span>
                </button>
            {/each}
        </div>
        {#if moreOpen && more.length > 0}
            <div class="more" role="menu">
                {#each more as row (row.id)}
                    <button
                        type="button"
                        role="menuitem"
                        class="u-menu-row"
                        class:u-danger={row.tone === "danger"}
                        data-testid={row.testId}
                        on:click|preventDefault={() => dispatch("select", row.id)}
                    >
                        <span class="u-menu-tile"
                            >{#if row.icon}<svelte:component this={row.icon} />{:else if row.iconSrc}<img
                                    src={row.iconSrc}
                                    alt=""
                                />{/if}</span
                        >
                        <span class="u-menu-label">{row.label}</span>
                    </button>
                {/each}
            </div>
        {/if}
    {/if}
</div>

<style lang="scss">
    .person-card {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 384px;
        max-width: 100%;
        max-height: calc(100dvh - 100px);
        border-radius: 20px;
        overflow: hidden;
        color: #fff;
        font-family: Inter, system-ui, sans-serif;
        pointer-events: auto;
    }
    .person-card.phone {
        width: 100%;
        border-radius: 20px 20px 0 0;
    }
    .close {
        position: absolute;
        top: 10px;
        inset-inline-end: 10px;
        z-index: 2;
    }
    .scroll {
        min-height: 0;
        flex: 1;
        overflow-y: auto;
        overscroll-behavior: contain;
    }
    .who {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 18px 56px 6px 18px;
    }
    .woka {
        position: relative;
        flex: none;
        width: 64px;
        height: 64px;
    }
    .sprite {
        display: block;
        width: 64px;
        height: 64px;
        background-size: 192px 256px;
        background-position: -64px 0;
        image-rendering: pixelated;
    }
    .sprite.placeholder {
        background: radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.12), transparent 60%);
        border-radius: 50%;
    }
    .mood {
        position: absolute;
        top: -2px;
        inset-inline-end: -8px;
        font-size: 20px;
        line-height: 1;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
    }
    .names {
        min-width: 0;
        display: grid;
        gap: 3px;
    }
    .name {
        margin: 0;
        font-size: 20px;
        line-height: 1.2;
        font-weight: 700;
        text-transform: none;
        letter-spacing: 0;
        overflow-wrap: anywhere;
    }
    .status {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.72);
    }
    .dot {
        display: block;
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
    }
    .badges {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 3px;
    }
    .pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 22px;
        padding: 0 9px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        font-size: 12px;
        font-weight: 600;
    }
    .pill .dot {
        width: 7px;
        height: 7px;
    }
    .friend,
    .blocked {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 600;
        color: #c4b5fd;
    }
    .blocked {
        color: rgba(255, 255, 255, 0.6);
    }
    .friend :global(svg),
    .blocked :global(svg) {
        width: 15px;
        height: 15px;
    }
    .body {
        padding: 0 2px;
    }
    .body:empty,
    .body.wait {
        display: none;
    }
    .body-wait {
        display: grid;
        gap: 8px;
        padding: 16px 18px 18px;
    }
    .body-wait i,
    .tile.wait {
        display: block;
        border-radius: 8px;
        background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.05),
            rgba(255, 255, 255, 0.1),
            rgba(255, 255, 255, 0.05)
        );
    }
    .body-wait i {
        height: 12px;
    }
    .body-wait i.short {
        width: 60%;
    }
    .grid {
        flex: none;
        display: grid;
        grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
        gap: 8px;
        padding: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
        background: rgb(var(--u-ink) / 0.6);
    }
    .tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-height: 60px;
        margin: 0;
        padding: 8px 4px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font: inherit;
        cursor: pointer;
    }
    .tile.wait {
        border-color: transparent;
        border-radius: 14px;
    }
    .tile:hover {
        background: rgba(255, 255, 255, 0.12);
    }
    .tile.go {
        border-color: transparent;
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .tile.open {
        background: rgba(134, 41, 252, 0.14);
        border-color: rgba(167, 139, 250, 0.7);
    }
    .tile :global(.tile-icon),
    .u-menu-tile img {
        width: 22px;
        height: 22px;
    }
    .tile-label {
        font-size: 12.5px;
        font-weight: 600;
        line-height: 1.2;
        text-align: center;
    }
    .phone .grid {
        padding-bottom: calc(12px + env(safe-area-inset-bottom));
    }
    .more {
        padding: 0 8px 8px;
        background: rgb(var(--u-ink) / 0.6);
    }
    .progress {
        margin: 0;
        display: grid;
        gap: 8px;
        padding: 14px 18px 18px;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.75);
        text-align: center;
    }
    .progress .bar {
        display: block;
        height: 4px;
        border-radius: 99px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
    }
    .progress .bar i {
        display: block;
        width: 45%;
        height: 100%;
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
</style>
