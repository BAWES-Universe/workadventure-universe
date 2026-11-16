<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import AppSheet from "./AppSheet.svelte";
    import { cleanKey } from "./GitHub";
    import { IconExternalLink, IconLock } from "@wa-icons";

    /**
     * "Use your own GitHub key" (game #2041): for a place the GitHub sign-in can't reach. Step 1 opens GitHub's own page for a
     * new key with everything filled in; step 2 takes the key. It goes straight to Orbit, which checks it with GitHub and keeps
     * it locked: nothing here keeps it after Save.
     */
    export let ownKeyPage: string;
    /** Sends the key; "saved", "refused" (GitHub did not take it) or "failed" */
    export let onSave: (key: string) => Promise<"saved" | "refused" | "failed">;
    export let onClose: () => void;

    $: text = $LL.chat.brick.apps.github;
    let key = "";
    let busy = false;
    let problem: "refused" | "failed" | undefined;

    $: ready = cleanKey(key) !== "" && !busy;

    function openGitHub() {
        window.open(ownKeyPage, "_blank", "noopener");
    }

    async function save() {
        const clean = cleanKey(key);
        if (!clean || busy) return;
        busy = true;
        problem = undefined;
        const outcome = await onSave(clean);
        // eslint-disable-next-line require-atomic-updates
        busy = false;
        if (outcome !== "saved") problem = outcome;
        // eslint-disable-next-line require-atomic-updates
        else key = "";
    }
</script>

<AppSheet title={text.keyTitle()} sub={text.keySub()} {onClose} testId="gitHubKeySheet">
    <div class="st">
        <span class="n">1</span>
        <div class="b">
            <span class="t">{text.keyStep1()}</span>
            <span class="m">{text.keyStep1Line()}</span>
            <div>
                <PageButton tall testId="gitHubKeyOpen" on:click={openGitHub}
                    >{text.openGitHub()} <IconExternalLink font-size="16" /></PageButton
                >
            </div>
        </div>
    </div>
    <div class="st">
        <span class="n">2</span>
        <label class="b">
            <span class="t">{text.keyStep2()}</span>
            <input
                class="in"
                class:on={key !== ""}
                type="password"
                autocomplete="off"
                spellcheck="false"
                bind:value={key}
                data-testid="gitHubKeyInput"
            />
        </label>
    </div>
    <p class="nt"><IconLock font-size="14" /><span>{text.keyLocked()}</span></p>
    {#if problem}
        <p class="bad" data-testid="gitHubKeyProblem">{problem === "refused" ? text.keyRefused() : text.keyFailed()}</p>
    {/if}
    <svelte:fragment slot="buttons">
        <PageButton tall testId="gitHubKeyCancel" on:click={onClose}>{$LL.chat.brick.apps.cancel()}</PageButton>
        <PageButton tall go disabled={!ready} testId="gitHubKeySave" on:click={() => void save()}
            >{busy ? text.savingKey() : text.saveKey()}</PageButton
        >
    </svelte:fragment>
</AppSheet>

<style>
    .st {
        display: flex;
        gap: 12px;
    }
    .n {
        display: grid;
        place-items: center;
        flex: none;
        width: 26px;
        height: 26px;
        border-radius: 999px;
        background: rgba(167, 139, 250, 0.18);
        font-size: 13px;
        font-weight: 700;
        color: #c9b8ff;
    }
    .b {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }
    .t {
        font-size: 14px;
        font-weight: 600;
        color: #fff;
    }
    .m {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .in {
        width: 100%;
        height: 44px;
        box-sizing: border-box;
        margin: 0;
        padding: 0 12px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        font: inherit;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 14px;
        color: #fff;
    }
    .in.on,
    .in:focus,
    .in:focus-visible {
        outline: none;
        box-shadow: none;
        border-color: rgba(167, 139, 250, 0.7);
    }
    .nt {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin: 0;
        font-size: 12.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .nt :global(svg) {
        flex: none;
        margin-top: 2px;
    }
    .bad {
        margin: 0;
        font-size: 13px;
        color: #ff8a7a;
    }
</style>
