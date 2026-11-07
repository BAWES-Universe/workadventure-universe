<script lang="ts">
    import type { BotToolSignIn, ToolSignInLost } from "../../Bots/BotToolSignIn";
    import { stillLost, toolSignInSince } from "../../Bots/BotToolSignIn";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { reconnectBotServer } from "../../../external-modules/bots/services/reconnectServer";
    import { openBotPage } from "../../../external-modules/bots/index";
    import { IconCheck, IconEye, IconLogin, IconX } from "@wa-icons";

    /**
     * The card a bot shows one person who manages it when a tool's sign-in expired (#1819, mock approved 5 Nov 2026).
     * Pinned above the message box like a waiting ask-first card: the chat moves up to make room, and the X closes it.
     * Same look as the reply limit card. Only they see it; no AI wrote it. Before it shows, Orbit is asked whether the
     * sign-in is still lost, so a card from yesterday never offers a fix that is done.
     */
    export let signIn: BotToolSignIn;
    /** X: hides the card for this person. The bot's page and Orbit home still show the lost sign-in. */
    export let onClose: () => void = () => {};

    type RowState = "lost" | "waiting" | "back";
    let states = new Map<string, RowState>();
    // What Orbit said when the card opened: connections that are not lost any more leave the card
    let rows: ToolSignInLost[] = signIn.lost;
    let blocked = false;

    // `states` is passed in, so the card draws again when a row's state changes
    function stateOf(known: Map<string, RowState>, row: ToolSignInLost): RowState {
        return known.get(row.serverId) ?? "lost";
    }
    $: open = rows.filter((row) => stateOf(states, row) !== "back");
    $: one = rows.length === 1 ? rows[0] : undefined;

    function setState(row: ToolSignInLost, state: RowState): void {
        states = new Map(states).set(row.serverId, state);
    }

    async function check(): Promise<{ id: string; signInLostAt?: string | null }[] | undefined> {
        try {
            return await botApiService.getBotMcpServers(signIn.botId);
        } catch {
            // Orbit can't be asked from here: the card shows as the bot sent it
            return undefined;
        }
    }

    // Asked as the card opens
    void check().then((servers) => {
        if (!servers) return;
        const lost = stillLost(signIn.lost, servers);
        rows = lost;
        // Nothing is lost any more: the card has nothing to offer
        if (lost.length === 0) onClose();
    });

    async function reconnect(row: ToolSignInLost): Promise<void> {
        if (stateOf(states, row) === "waiting") return;
        // A pasted key or token is typed on the server's own page
        if (row.kind !== "oauth") {
            openBotPage(signIn.botId);
            return;
        }
        blocked = false;
        setState(row, "waiting");
        const result = await reconnectBotServer(signIn.botId, row.serverId);
        if (result === "blocked") blocked = true;
        if (result !== "done") {
            setState(row, "lost");
            return;
        }
        const servers = await check();
        const server = servers?.find((candidate) => candidate.id === row.serverId);
        // Orbit clears the mark when the sign-in is stored; if it can't be asked, the provider's yes is what there is
        setState(row, server?.signInLostAt ? "lost" : "back");
    }
</script>

<div class="tool-signin docked mx-4 flex flex-col" data-testid="botToolSignInCard">
    <div class="tool-signin-head">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="tool-signin-from" dir="auto">{signIn.botName}</span>
            <b class="tool-signin-title" dir="auto">
                {#if open.length === 0}
                    {#if one}{$LL.chat.toolSignIn.titleBackOne({
                            name: one.name,
                        })}{:else}{$LL.chat.toolSignIn.titleBackMany()}{/if}
                {:else if one}
                    {$LL.chat.toolSignIn.titleOne({ name: one.name })}
                {:else}
                    {$LL.chat.toolSignIn.titleMany({ count: open.length })}
                {/if}
            </b>
            <p class="tool-signin-line m-0" dir="auto">
                {#if open.length === 0}
                    {$LL.chat.toolSignIn.lineBack({ bot: signIn.botName })}
                {:else if one}
                    {$LL.chat.toolSignIn.lineOne({
                        time: toolSignInSince(one.since, $locale),
                        bot: signIn.botName,
                        name: one.name,
                    })}
                {:else}
                    {$LL.chat.toolSignIn.lineMany({ bot: signIn.botName })}
                {/if}
            </p>
        </div>
        <button
            type="button"
            class="tool-signin-x"
            aria-label={$LL.chat.toolSignIn.close()}
            data-testid="botToolSignInClose"
            on:click={onClose}><IconX /></button
        >
    </div>
    {#if one}
        {#if stateOf(states, one) === "back"}
            <button class="tool-signin-cta done" disabled data-testid="botToolSignInDone"
                ><IconCheck />{$LL.chat.toolSignIn.reconnected()}</button
            >
        {:else}
            <button
                class="tool-signin-cta"
                disabled={stateOf(states, one) === "waiting"}
                on:click={() => reconnect(one)}
                data-testid="botToolSignInReconnect"
            >
                <IconLogin />
                {#if stateOf(states, one) === "waiting"}
                    {$LL.chat.toolSignIn.waiting({ name: one.name })}
                {:else if one.kind === "oauth"}
                    {$LL.chat.toolSignIn.reconnect({ name: one.name })}
                {:else}
                    {$LL.chat.toolSignIn.pasteKey({ name: one.name })}
                {/if}
            </button>
        {/if}
    {:else}
        {#each rows as row (row.serverId)}
            <button
                class="tool-signin-row"
                class:done={stateOf(states, row) === "back"}
                disabled={stateOf(states, row) !== "lost"}
                on:click={() => reconnect(row)}
                data-testid="botToolSignInRow"
            >
                <span class="flex min-w-0 flex-col items-start">
                    <b>
                        {#if stateOf(states, row) === "back"}
                            {$LL.chat.toolSignIn.rowBack({ name: row.name })}
                        {:else if stateOf(states, row) === "waiting"}
                            {$LL.chat.toolSignIn.waiting({ name: row.name })}
                        {:else if row.kind === "oauth"}
                            {$LL.chat.toolSignIn.reconnect({ name: row.name })}
                        {:else}
                            {$LL.chat.toolSignIn.pasteKey({ name: row.name })}
                        {/if}
                    </b>
                    <span>
                        {stateOf(states, row) === "back"
                            ? $LL.chat.toolSignIn.rowBackLine()
                            : $LL.chat.toolSignIn.rowSince({ time: toolSignInSince(row.since, $locale) })}
                    </span>
                </span>
                {#if stateOf(states, row) === "back"}<IconCheck />{:else}<IconLogin />{/if}
            </button>
        {/each}
    {/if}
    {#if blocked}
        <span class="tool-signin-hint" role="status">{$LL.chat.toolSignIn.blocked()}</span>
    {/if}
    <span class="tool-signin-who"><IconEye />{$LL.chat.toolSignIn.onlyYou({ bot: signIn.botName })}</span>
</div>

<style>
    .tool-signin {
        gap: 8px;
        padding: 12px;
        border-radius: 16px;
        color: #fff;
        background: linear-gradient(160deg, rgba(31, 28, 47, 0.96), rgba(20, 18, 30, 0.97));
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.22), 0 0 24px -12px rgba(134, 41, 252, 0.55);
        overflow-wrap: anywhere;
    }
    /* Pinned above the message box like a waiting ask-first card (#1657): the chat above moves up to make room */
    .tool-signin.docked {
        margin-bottom: 8px;
        max-height: 60vh;
        overflow-y: auto;
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.32), 0 -12px 32px -12px rgba(0, 0, 0, 0.6),
            0 0 24px -12px rgba(134, 41, 252, 0.55);
    }
    .tool-signin-head {
        display: flex;
        align-items: flex-start;
        gap: 4px;
    }
    .tool-signin-from {
        font-size: 12px;
        font-weight: 600;
        color: #c4b5fd;
    }
    /* Plain icon, no tile behind it; the tap area is still 44px. */
    .tool-signin-x {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        margin: -10px -10px -10px 0;
        padding: 0;
        border: 0;
        background: none;
        color: rgba(255, 255, 255, 0.7);
        cursor: pointer;
    }
    .tool-signin-x :global(svg) {
        width: 20px;
        height: 20px;
    }
    .tool-signin-title {
        font-size: 14px;
        line-height: 19px;
    }
    .tool-signin-line {
        font-size: 13px;
        line-height: 18px;
        color: rgba(255, 255, 255, 0.75);
    }
    .tool-signin-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        min-height: 44px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.7);
        cursor: pointer;
    }
    .tool-signin-cta:disabled {
        cursor: default;
    }
    .tool-signin-cta :global(svg),
    .tool-signin-row :global(svg) {
        width: 18px;
        height: 18px;
        flex: none;
    }
    .tool-signin-cta.done {
        background: rgba(167, 139, 250, 0.18);
        box-shadow: none;
        color: rgba(255, 255, 255, 0.85);
    }
    /* Several connections: one quiet tap row each, 52 px, like the bot page's rows */
    .tool-signin-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 52px;
        padding: 6px 12px;
        border: 0;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .tool-signin-row:disabled {
        cursor: default;
    }
    .tool-signin-row b {
        font-size: 14px;
    }
    .tool-signin-row span span {
        font-size: 12.5px;
        color: rgba(255, 255, 255, 0.64);
    }
    .tool-signin-row.done {
        color: rgba(255, 255, 255, 0.85);
    }
    .tool-signin-hint {
        font-size: 12.5px;
        color: rgba(255, 255, 255, 0.64);
    }
    .tool-signin-who {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.5);
    }
    .tool-signin-who :global(svg) {
        width: 1.2em;
        height: 1.2em;
    }
</style>
