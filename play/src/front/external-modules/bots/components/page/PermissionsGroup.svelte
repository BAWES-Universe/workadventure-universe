<script lang="ts">
    // Permissions: who may use the bot, and who may have it change, delete or send. Make private closes the bot to
    // everyone but the roles and people listed (after a confirmation that says who is left); each row opens that role's
    // or person's No / Default / Yes screen; the line under them is what a person the owner has refused hears.
    // Changes save on their own.
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
    import PageButton from "./PageButton.svelte";
    import ConfirmSheet from "./ConfirmSheet.svelte";
    import { IconChevronRight, IconLock, IconPlus, IconUser } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    /** A row was tapped: its screen opens in place of the page */
    export let onOpenRule: (rule: BotRule) => void;
    export let onAdd: () => void;
    /** A Brick's page: it is on no map, so only its owner reaches it and there are no roles or rules to show yet */
    export let brick = false;

    $: page = $LL.mapEditor.edit.bots.page;
    $: access = page.access;
    $: state = $botPermissionsStore;
    $: data = state && state.botId === bot.id ? state.data : undefined;
    $: failed = state?.botId === bot.id && state.status === "failed";
    $: saveError = state?.botId === bot.id ? state.saveError : undefined;

    let loadedFor: string | undefined;
    $: if (!brick && bot.id !== loadedFor) {
        loadedFor = bot.id;
        void loadBotPermissions(bot.id);
    }

    /** "A", "A and B", "A, B and C" */
    function names(list: string[]): string {
        return list.length <= 1
            ? list.join("")
            : `${list.slice(0, -1).join(", ")} ${access.and()} ${list[list.length - 1]}`;
    }

    // The roles and people with rules of their own, and the ones such a rule says Yes to using the bot: on a Private
    // bot only a Yes lets someone in
    $: ruleNames = (data?.rules ?? []).map((rule) => ruleName(rule, access.someone()));
    $: usingNames = (data?.rules ?? [])
        .filter((rule) => rule.chat === "yes" || rule.dm === "yes" || rule.summon === "yes")
        .map((rule) => ruleName(rule, access.someone()));

    function briefOf(permissions: BotPermissions | undefined, loadFailed: boolean, ruleNames: string[]): string {
        if (loadFailed) return access.briefFailed();
        if (!permissions) return access.briefLoading();
        if (ruleNames.length === 0) return permissions.privateBot ? access.briefPrivate() : access.briefOpen();
        const shown =
            ruleNames.length > 3
                ? access.briefMore({ first: ruleNames[0], second: ruleNames[1], count: ruleNames.length - 2 })
                : names(ruleNames);
        return permissions.privateBot
            ? access.briefPrivateRules({ names: shown })
            : access.briefOpenRules({ names: shown });
    }
    $: brief = brick ? access.brickBrief() : briefOf(data, failed, ruleNames);

    // Who can always use the bot, by name, so nobody reads "the owner" as being themselves
    // When the person who made the bot also owns the universe, they are named once (as the owner)
    $: owner = data?.universe?.ownerName || undefined;
    $: maker = bot.createdBy?.name && bot.createdBy.name !== owner ? bot.createdBy.name : undefined;
    $: universeName = data?.universe?.name;
    $: alwaysNames =
        owner && universeName
            ? maker
                ? access.alwaysNamesMaker({ maker, owner, universe: universeName })
                : access.alwaysNamesOwner({ owner, universe: universeName })
            : maker
            ? access.alwaysNamesMakerOnly({ maker })
            : access.alwaysNamesNobody();
    $: alwaysLine =
        owner && universeName
            ? maker
                ? access.alwaysMaker({ maker, owner, universe: universeName })
                : access.alwaysOwner({ owner, universe: universeName })
            : maker
            ? access.alwaysMakerOnly({ maker })
            : access.alwaysNobody();

    // Which roles let the people in them have the bot change things, and delete or send. Admin always does and
    // Orbit leaves it out of the roles it lists, so it is named first.
    function toolsLineOf(permissions: BotPermissions | undefined): string {
        if (!permissions) return "";
        const admin = "Admin";
        const roles = permissions.roles ?? [];
        const change = [admin, ...roles.filter((role) => role.defaults.change).map((role) => role.name)];
        const send = [admin, ...roles.filter((role) => role.defaults.deleteOrSend).map((role) => role.name)];
        return [
            access.toolsChange({ names: names(change) }),
            access.toolsSend({ names: names(send) }),
            access.toolsTap(),
        ].join(" ");
    }
    $: toolsLine = toolsLineOf(data);

    // Make private / Make public asks first: it says who can use the bot afterwards
    let confirming: "private" | "public" | null = null;
    $: confirmation = confirming && data ? confirmationOf(confirming, data) : undefined;

    function confirmationOf(kind: "private" | "public", permissions: BotPermissions) {
        const guests = access.guestsToo();
        if (kind === "public") {
            return {
                title: access.makePublicTitle({ name: bot.name || access.thisBot() }),
                lines: [
                    { text: access.publicOpens({ guests }), bold: [guests] },
                    ...(ruleNames.length ? [{ text: access.publicKeeps({ names: names(ruleNames) }), bold: [] }] : []),
                ],
                note: access.publicAgain(),
                confirm: access.makePublic(),
            };
        }
        const reply = permissions.refusalReply || access.replyPlaceholder();
        const who = names(usingNames);
        return {
            title: access.makePrivateTitle({ name: bot.name || access.thisBot() }),
            lines: [
                usingNames.length
                    ? { text: access.privateOnly({ names: who }), bold: [who] }
                    : { text: access.privateNobody({ always: alwaysNames }), bold: [] },
                { text: access.privateEveryoneElse({ guests, reply }), bold: [guests] },
                ...(usingNames.length ? [{ text: alwaysLine, bold: [] }] : []),
            ],
            note: access.privateAgain(),
            confirm: access.makePrivate(),
        };
    }

    function confirmVisibility() {
        if (!confirming) return;
        const makePrivate = confirming === "private";
        confirming = null;
        void setPrivateBot(bot.id, makePrivate);
    }

    function summaryOf(rule: BotRule): string {
        return ruleSummary(rule, {
            blocked: access.blocked(),
            follows: access.follows(),
            action: {
                chat: access.actions.chat(),
                dm: access.actions.dm(),
                summon: access.actions.summon(),
                manage: access.actions.manage(),
                change: access.actions.changeShort(),
                deleteOrSend: access.actions.deleteOrSendShort(),
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
    {#if brick}
        <div class="bp-set" data-testid="brick-access">
            <span class="bp-tx">
                <span class="bp-t">{access.brickTitle()}</span>
                <span class="bp-m">{access.brickLine({ name: bot.name || access.thisBot() })}</span>
            </span>
        </div>
    {:else if failed}
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
        <div class="bp-set" data-testid="bot-visibility">
            <span class="bp-tx">
                <span class="bp-t">{data.privateBot ? access.privateBot() : access.publicBot()}</span>
                <span class="bp-m"
                    >{!data.privateBot
                        ? access.publicLine()
                        : usingNames.length
                        ? access.privateLine({ names: names(usingNames) })
                        : access.privateEmptyLine({ always: alwaysNames })}</span
                >
            </span>
            <PageButton
                tall
                testId="bot-visibility-change"
                on:click={() => (confirming = data?.privateBot ? "public" : "private")}
                >{data.privateBot ? access.makePublic() : access.makePrivate()}</PageButton
            >
        </div>

        <div class="bp-set" data-testid="bot-access-tools-line">
            <span class="bp-tx">
                <span class="bp-t">{access.toolsTitle()}</span>
                <span class="bp-m">{toolsLine}</span>
            </span>
        </div>

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

        <PageField title={access.reply()} hint={access.replyHint()}>
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

{#if confirmation}
    <ConfirmSheet
        title={confirmation.title}
        lines={confirmation.lines}
        note={confirmation.note}
        cancelLabel={access.cancel()}
        confirmLabel={confirmation.confirm}
        testId="bot-visibility-sheet"
        onCancel={() => (confirming = null)}
        onConfirm={confirmVisibility}
    />
{/if}

<style>
    /* A setting with its words on the left and, when it has one, its button on the right, 44 px tall */
    .bp-set {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
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
