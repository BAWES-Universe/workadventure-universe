<script lang="ts">
    // Permissions: who may use the bot. Private bot closes it to everyone but the roles and people listed; each row
    // opens that role's or person's No / Default / Yes screen; the line under them is what a person the owner has
    // refused hears. Changes save on their own.
    import { onDestroy } from "svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import {
        botPermissionsStore,
        loadBotPermissions,
        setPrivateBot,
        setRefusalReply,
    } from "../../stores/BotPermissionsStore";
    import { REFUSAL_REPLY_MAX, ruleName, ruleSummary, type BotPermissions, type BotRule } from "../../accessModel";
    import PageGroup from "./PageGroup.svelte";
    import PageField from "./PageField.svelte";
    import PageSwitch from "./PageSwitch.svelte";
    import PageButton from "./PageButton.svelte";
    import { IconChevronRight, IconLock, IconPlus, IconUser } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    /** A row was tapped: its screen opens in place of the page */
    export let onOpenRule: (rule: BotRule) => void;
    export let onAdd: () => void;

    $: page = $LL.mapEditor.edit.bots.page;
    $: access = page.access;
    $: state = $botPermissionsStore;
    $: data = state && state.botId === bot.id ? state.data : undefined;
    $: failed = state?.botId === bot.id && state.status === "failed";
    $: saveError = state?.botId === bot.id ? state.saveError : undefined;

    let loadedFor: string | undefined;
    $: if (bot.id !== loadedFor) {
        loadedFor = bot.id;
        void loadBotPermissions(bot.id);
    }

    function briefOf(permissions: BotPermissions | undefined, loadFailed: boolean): string {
        if (loadFailed) return access.briefFailed();
        if (!permissions) return access.briefLoading();
        const count = permissions.rules.length;
        if (permissions.privateBot) {
            return count > 0 ? access.briefPrivateRules({ count }) : access.briefPrivate();
        }
        return count > 0 ? access.briefOpenRules({ count }) : access.briefOpen();
    }
    // Mock: the brief names who has their own rules instead of a bare count
    $: ruleNames = (data?.rules ?? []).map((r) => ruleName(r, access.someone()));
    $: shortNames = ruleNames.length > 3 ? `${ruleNames.slice(0, 2).join(", ")} and ${ruleNames.length - 2} more` : names2(ruleNames);
    $: brief = liveView
        ? briefOf(data, failed)
        : !data
        ? briefOf(data, failed)
        : `${data.privateBot ? "Private" : "Public"}${ruleNames.length ? ` · own rules for ${shortNames}` : ""}`;

    // Mock: Make public / Make private, each with a confirmation that says who gains or loses access
    let confirming: "private" | "public" | null = null;
    $: listed = (data?.rules ?? [])
        .filter((r) => !(["chat", "dm", "summon"] as const).every((a) => r[a] === "no"))
        .map((r) => ruleName(r, access.someone()));
    function names2(list: string[]): string {
        return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    }
    // Mock: who can always use the bot, by name, so nobody reads "the owner" as themselves. The build gets the
    // universe's name and its owner's name from Orbit with the permissions.
    const universe = { name: "Nova", owner: "Layla" };
    $: maker = (bot as { createdBy?: { name?: string } }).createdBy?.name;
    $: alwaysLine = `${maker ? `${maker} made this bot and ` : ""}${universe.owner} owns ${universe.name}, so they can always use this bot, and so can ${universe.name}'s Admins.`;
    $: alwaysShort = `${maker ? `${maker} (made this bot), ` : ""}${universe.owner} (owns ${universe.name}) and ${universe.name}'s Admins`;
    function confirmVisibility() {
        if (!confirming) return;
        void setPrivateBot(bot.id, confirming === "private");
        confirming = null;
    }

    $: privateHint = !data?.privateBot
        ? access.privateOffHint()
        : data.rules.length === 0
        ? access.privateOnEmptyHint()
        : access.privateOnHint();

    // Mock (d=live hides it): who the roles let have the bot use its tools, so the starting point isn't hidden
    const liveView = new URLSearchParams(location.search).get("d") === "live";
    function names(list: string[]): string {
        return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    }
    function toolsLineOf(permissions: BotPermissions | undefined): string {
        if (!permissions) return "";
        const change = permissions.roles.filter((r) => r.defaults.change).map((r) => r.name);
        const send = permissions.roles.filter((r) => r.defaults.send).map((r) => r.name);
        const a = change.length ? `${names(change)} can have this bot change things.` : "Nobody can have this bot change things yet.";
        const b = send.length ? ` ${names(send)} can also have this bot delete or send.` : " Nobody can have this bot delete or send yet.";
        return a + b + " Tap a role or person to set them differently.";
    }
    $: toolsLine = toolsLineOf(data);

    function summaryOf(rule: BotRule): string {
        return ruleSummary(rule, {
            blocked: access.blocked(),
            follows: access.follows(),
            action: {
                chat: access.actions.chat(),
                dm: access.actions.dm(),
                summon: access.actions.summon(),
                manage: access.actions.manage(),
                change: "Change things",
                send: "Delete or send",
            },
            allowsAndBlocks: (allows, blocks) => access.allowsAndBlocks({ allows, blocks }),
            blocksOnly: (blocks) => access.blocksOnly({ blocks }),
        });
    }

    // The line refused people hear: saved once typing stops, when the box is left, and when the page moves on
    // The draft belongs to the bot it was typed for: when the page moves to another bot meanwhile, it is still saved
    // to the first one and never shown or sent to the second
    let reply: { botId: string; text: string } | undefined;
    let replyTimeout: ReturnType<typeof setTimeout> | null = null;
    let replyFocused = false;
    $: replyShown = (reply?.botId === bot.id ? reply.text : undefined) ?? data?.refusalReply ?? "";

    function typeReply(event: Event) {
        reply = { botId: bot.id, text: (event.currentTarget as HTMLTextAreaElement).value };
        if (replyTimeout) clearTimeout(replyTimeout);
        replyTimeout = setTimeout(saveReply, 800);
    }

    // What is being saved right now, so the timer and the box being left do not send the same words twice
    let replySaving: { botId: string; text: string } | undefined;

    // The words stay in the box until Orbit has them: if it refuses, they are still there to try again
    function saveReply() {
        if (replyTimeout) {
            clearTimeout(replyTimeout);
            replyTimeout = null;
        }
        const draft = reply;
        if (draft === undefined) return;
        if (draft.botId === bot.id && data && draft.text.trim() === (data.refusalReply ?? "")) {
            reply = undefined;
            return;
        }
        if (replySaving?.botId === draft.botId && replySaving.text === draft.text) return;
        replySaving = draft;
        void setRefusalReply(draft.botId, draft.text)
            .then((saved) => {
                // Orbit keeps the line without its trailing spaces: while the box is being typed in, it keeps what the
                // person typed, so the next word still has its space, and settles when the box is left
                if (saved && reply === draft && !(replyFocused && draft.text !== draft.text.trim())) reply = undefined;
            })
            .finally(() => {
                if (replySaving === draft) replySaving = undefined;
            });
    }

    onDestroy(saveReply);
</script>

<PageGroup id="access" icon={IconLock} title={access.title()} {brief} {open} {onToggle}>
    {#if failed}
        <p class="bp-m" role="alert">{access.loadFailed()}</p>
        <button
            type="button"
            class="bp-pill"
            data-testid="bot-access-retry"
            on:click={() => loadBotPermissions(bot.id)}
        >
            {access.tryAgain()}
        </button>
    {:else if !data}
        <p class="bp-m">{access.briefLoading()}</p>
    {:else}
{#if liveView}
        <label class="bp-set" for="bot-private-{bot.id}">
            <span class="bp-tx">
                <span class="bp-t">{access.privateBot()}</span>
                <span class="bp-m">{privateHint}</span>
            </span>
            <PageSwitch
                checked={data.privateBot}
                label={access.privateBot()}
                id="bot-private-{bot.id}"
                testId="bot-private"
                onChange={(on) => setPrivateBot(bot.id, on)}
            />
        </label>
        {:else}
            <div class="bp-set bp-info" data-testid="bot-visibility">
                <span class="bp-tx">
                    <span class="bp-t">{data.privateBot ? "Private bot" : "Public bot"}</span>
                    <span class="bp-m"
                        >{data.privateBot
                            ? listed.length
                                ? `Only ${names2(listed)} can use this bot`
                                : `Only ${maker ? `${maker}, ` : ""}${universe.owner} and ${universe.name}'s Admins can use this bot until you add someone`
                            : "Anyone who can enter this bot's room can use this bot, guests too"}</span
                    >
                </span>
                <PageButton testId="bot-visibility-change" on:click={() => (confirming = data?.privateBot ? "public" : "private")}
                    >{data.privateBot ? "Make public" : "Make private"}</PageButton
                >
            </div>
        {/if}

        {#if !liveView}
            <div class="bp-set bp-info" data-testid="bot-access-tools-line">
                <span class="bp-tx">
                    <span class="bp-t">Changing, deleting and sending</span>
                    <span class="bp-m">{toolsLine}</span>
                </span>
            </div>
        {/if}

        {#each data.rules as rule (rule.id)}
            <button type="button" class="bp-rule" data-testid="bot-access-rule" on:click={() => onOpenRule(rule)}>
                {#if rule.role}
                    <span class="bp-dot" style="background: {rule.role.color || '#A3A3B5'}" aria-hidden="true" />
                {:else}
                    <span class="bp-ico" aria-hidden="true"><IconUser font-size="20" /></span>
                {/if}
                <span class="bp-tx">
                    <span class="bp-t">{ruleName(rule, access.someone())}</span>
                    <span class="bp-m">{summaryOf(rule)}</span>
                </span>
                <span class="bp-chev" aria-hidden="true"><IconChevronRight font-size="18" /></span>
            </button>
        {/each}

        <button type="button" class="bp-add" data-testid="bot-access-add" on:click={onAdd}>
            <IconPlus font-size="18" />
            {access.add()}
        </button>

        <PageField
            title={liveView ? access.reply() : "Reply to people who can't use this bot"}
            hint={liveView ? access.replyHint() : "This bot sends these words once to each person who isn't allowed. What they type never reaches this bot's AI."}
        >
            <textarea
                class="bp-text"
                rows="2"
                maxlength={REFUSAL_REPLY_MAX}
                value={replyShown}
                placeholder={access.replyPlaceholder()}
                aria-label={access.reply()}
                data-testid="bot-access-reply"
                on:input={typeReply}
                on:focus={() => (replyFocused = true)}
                on:blur={() => {
                    replyFocused = false;
                    saveReply();
                }}
            />
        </PageField>
    {/if}
    {#if saveError}
        <p class="bp-error" role="alert" data-testid="bot-access-error">{saveError}</p>
    {/if}
</PageGroup>

{#if confirming && data}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="bp-sheet-bg" data-testid="bot-visibility-sheet" on:click|self={() => (confirming = null)}>
        <div class="bp-sheet" role="dialog" aria-modal="true" aria-labelledby="bp-sheet-title">
            <h3 id="bp-sheet-title">{confirming === "private" ? `Make ${bot.name} private?` : `Make ${bot.name} public?`}</h3>
            {#if confirming === "private"}
                <ul>
                    {#if listed.length}
                        <li>Only <b>{names2(listed)}</b> will be able to use this bot, each with the rules set for them.</li>
                    {:else}
                        <li>No roles or people are added yet, so only {alwaysShort} will be able to use this bot.</li>
                    {/if}
                    <li>
                        Everyone else, <b>guests too</b>, won't be able to chat with, DM or summon this bot. This bot answers
                        them with: “{data.refusalReply || access.replyPlaceholder()}”
                    </li>
                    {#if listed.length}<li>{alwaysLine}</li>{/if}
                </ul>
                <p class="bp-sheet-m">You can make this bot public again any time.</p>
            {:else}
                <ul>
                    <li>
                        Anyone who can enter this bot's room, <b>guests too</b>, will be able to chat with and summon this bot.
                        Anyone signed in can also DM this bot.
                    </li>
                    {#if ruleNames.length}<li>{names2(ruleNames)} keep the rules set for them.</li>{/if}
                </ul>
                <p class="bp-sheet-m">You can make this bot private again any time.</p>
            {/if}
            <div class="bp-sheet-btns">
                <PageButton tall on:click={() => (confirming = null)}>Cancel</PageButton>
                <PageButton tall go testId="bot-visibility-confirm" on:click={confirmVisibility}
                    >{confirming === "private" ? "Make private" : "Make public"}</PageButton
                >
            </div>
        </div>
    </div>
{/if}

<style>
    /* A setting with a switch: the whole row is the tap area, 44 px tall like the bot page's other rows */
    .bp-set {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        cursor: pointer;
    }
    .bp-sheet-bg {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        background: rgba(5, 4, 10, 0.72);
    }
    :global(body.desk) .bp-sheet-bg {
        align-items: center;
    }
    .bp-sheet {
        width: 100%;
        max-width: 440px;
        padding: 20px 18px calc(18px + env(safe-area-inset-bottom));
        border-radius: 20px 20px 0 0;
        background: #15121f;
        color: #f4f2fa;
    }
    :global(body.desk) .bp-sheet {
        border-radius: 20px;
    }
    .bp-sheet h3 {
        margin: 0 0 10px;
        font: inherit;
        font-size: 18px;
        font-weight: 700;
        text-transform: none;
        letter-spacing: 0;
    }
    .bp-sheet ul {
        margin: 0;
        padding-left: 18px;
        font-size: 14px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.78);
    }
    .bp-sheet li {
        margin: 6px 0;
    }
    .bp-sheet b {
        color: #fff;
    }
    .bp-sheet-m {
        margin: 10px 0 0;
        font-size: 13px;
        color: rgba(244, 242, 250, 0.56);
    }
    .bp-sheet-btns {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 16px;
    }
    .bp-info {
        cursor: default;
    }
    .bp-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        text-align: left;
    }
    :global([dir="rtl"]) .bp-tx {
        text-align: right;
    }
    .bp-t {
        font-size: 13px;
        font-weight: 600;
    }
    .bp-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    /* A role or person with its own rules: opens their screen */
    .bp-rule {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 52px;
        margin: 0;
        padding: 6px 8px;
        border: 0;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        font: inherit;
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bp-rule:hover {
            background: rgba(255, 255, 255, 0.09);
        }
    }
    .bp-rule:focus-visible,
    .bp-add:focus-visible,
    .bp-pill:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .bp-dot {
        flex: none;
        width: 10px;
        height: 10px;
        margin: 0 11px;
        border-radius: 50%;
    }
    /* Plain white icon, like the menu: no tile behind it. */
    .bp-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: rgba(255, 255, 255, 0.85);
    }
    .bp-chev {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.64);
    }
    :global([dir="rtl"]) .bp-chev {
        transform: scaleX(-1);
    }
    .bp-add,
    .bp-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        align-self: flex-start;
        height: 44px;
        margin: 0;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bp-add:hover,
        .bp-pill:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
    .bp-text {
        box-sizing: border-box;
        width: 100%;
        min-height: 64px;
        margin: 0;
        padding: 10px 12px;
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 14px;
        line-height: 1.45;
        color: #fff;
        resize: vertical;
        outline: none;
    }
    .bp-text::placeholder {
        color: rgba(244, 242, 250, 0.42);
    }
    .bp-text:focus-visible {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .bp-error {
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
</style>
