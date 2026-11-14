<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import AppSheet from "./AppSheet.svelte";
    import { afterKeySaved, isModeChange, keyProblemOf, parseKeyForm, type KeyFormView, type KeyProblem } from "./KeyForm";

    /**
     * The safe form for a key (Keys for Apps, game #2044), the same sheet from the Brick's link and from "Replace key" on an
     * app's page. Says where the key goes and what is checked. The key lives only in this field: it is sent to Orbit, the field
     * is emptied, and nothing ever shows it again.
     */
    export let formId: string;
    export let onClose: () => void;

    $: text = $LL.chat.brick.apps;
    let form: KeyFormView | undefined;
    let loading = true;
    let problem: KeyProblem | undefined;
    let key = "";
    let busy = false;
    let done: { name: string } | undefined;
    // After a key of the other kind (test / real) than the one in use: the person is asked once, then it is sent again
    let confirming = false;

    onMount(async () => {
        try {
            form = parseKeyForm(await botApiService.getKeyForm(formId));
            if (!form) problem = "other";
        } catch (error) {
            problem = keyProblemOf(error);
        }
        loading = false;
    });

    $: short = form?.short ?? "";
    $: shownHost = form ? (form.hostReadable ?? form.host) : "";
    $: title = form
        ? form.replacing
            ? text.keyReplaceTitle({ short })
            : text.keyTitle({ short })
        : text.keyTitle({ short: "" }).trim();
    $: canSend = !busy && key.trim() !== "" && !!form;

    function problemText(which: KeyProblem): string {
        switch (which) {
            case "rejected":
                return text.keyErrRejected({ short });
            case "invalid":
                return text.keyErrInvalid({ short });
            case "unreachable":
                return text.keyErrUnreachable({ short });
            case "expired":
                return text.keyErrExpired();
            case "used":
                return text.keyErrUsed();
            case "tooMany":
                return text.keyErrTooMany();
            default:
                return text.keyErrOther();
        }
    }

    async function send(confirmChange = false) {
        if (!canSend) return;
        busy = true;
        problem = undefined;
        const typed = key;
        try {
            const saved = await botApiService.submitKey(formId, typed, confirmChange);
            // The key leaves this window the moment it is saved
            key = "";
            confirming = false;
            done = { name: saved.name || form?.name || short };
            await afterKeySaved();
        } catch (error) {
            if (isModeChange(error) && !confirmChange) {
                confirming = true;
            } else {
                confirming = false;
                problem = keyProblemOf(error);
                if (problem === "invalid" || problem === "rejected") key = "";
            }
        } finally {
            busy = false;
        }
    }

    $: modeNow = form?.replacing?.mode ?? null;
    $: modeFrom = modeNow === "live" ? text.keyModeLive() : text.keyModeTest();
    $: modeTo = modeNow === "live" ? text.keyModeTest() : text.keyModeLive();
</script>

<AppSheet {title} {onClose} testId="keySheet">
    {#if loading}
        <p class="ks-note" data-testid="keySheetLoading">…</p>
    {:else if done}
        <p class="ks-ok" data-testid="keySheetDone">{text.keyDone({ app: done.name })}</p>
        <p class="ks-note">{text.keyDoneNote()}</p>
    {:else if !form}
        <p class="ks-bad" data-testid="keySheetProblem">{problemText(problem ?? "other")}</p>
    {:else}
        {#if form.mode === "custom"}
            <p class="ks-warn" data-testid="keySheetCustom">
                {form.source
                    ? text.keyCustom({ source: form.source, host: shownHost })
                    : text.keyCustomNoSource({ host: shownHost })}
                {#if form.differentSite && form.source}{text.keyDifferentSite({ source: form.source })}{/if}
            </p>
        {:else}
            <p class="ks-note" data-testid="keySheetStored">{text.keyStored({ short, host: shownHost })}</p>
        {/if}
        <p class="ks-note">{text.keyAvailable()}</p>
        {#if form.replacing?.keyLast4}
            <p class="ks-note">{text.keyReplacing({ last4: form.replacing.keyLast4 })}</p>
        {/if}
        <form class="ks-fl" on:submit|preventDefault={() => void send(false)} autocomplete="off">
            <label class="ks-lb" for="key-sheet-input">{text.keyField({ short })}</label>
            <!-- A password field: the key is never shown over a shoulder, and the browser does not offer to remember it -->
            <input
                id="key-sheet-input"
                class="ks-in"
                type="password"
                name="universe-app-key"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder={form.keyHint ?? ""}
                data-testid="keySheetInput"
                bind:value={key}
                disabled={busy}
            />
            {#if form.helpUrl}
                <a class="ks-find" href={form.helpUrl} target="_blank" rel="noopener noreferrer" data-testid="keySheetFind"
                    >{text.keyFind()}</a
                >
            {/if}
        </form>
        {#if form.check}<p class="ks-note">{text.keyChecked({ check: form.check })}</p>{/if}
        {#if confirming}
            <p class="ks-warn" data-testid="keySheetModeChange">{text.keyModeChange({ from: modeFrom, to: modeTo })}</p>
        {/if}
        {#if problem}<p class="ks-bad" data-testid="keySheetProblem">{problemText(problem)}</p>{/if}
    {/if}
    <svelte:fragment slot="buttons">
        {#if done || !form}
            <PageButton tall go testId="keySheetClose" on:click={onClose}>{text.keyClose()}</PageButton>
        {:else}
            <PageButton tall testId="keySheetCancel" on:click={onClose}>{text.cancel()}</PageButton>
            {#if confirming}
                <PageButton tall go disabled={busy} testId="keySheetSwitch" on:click={() => void send(true)}
                    >{text.keyModeSwitch()}</PageButton
                >
            {:else}
                <PageButton tall go disabled={!canSend} testId="keySheetSave" on:click={() => void send(false)}
                    >{busy ? text.keyChecking() : text.keySave()}</PageButton
                >
            {/if}
        {/if}
    </svelte:fragment>
</AppSheet>

<style>
    .ks-note {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .ks-ok {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        color: #fff;
    }
    .ks-warn {
        margin: 0;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255, 200, 100, 0.1);
        font-size: 13px;
        line-height: 1.4;
        color: #ffd89a;
    }
    .ks-bad {
        margin: 0;
        font-size: 13px;
        color: #ff8a7a;
    }
    .ks-fl {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .ks-lb {
        font-size: 13px;
        font-weight: 700;
        color: #fff;
    }
    .ks-in {
        width: 100%;
        min-height: 48px;
        padding: 0 14px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.06);
        box-sizing: border-box;
        font: inherit;
        font-size: 16px;
        color: #fff;
    }
    .ks-in:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 1px;
    }
    .ks-find {
        align-self: flex-start;
        font-size: 13px;
        color: #a78bfa;
    }
</style>
