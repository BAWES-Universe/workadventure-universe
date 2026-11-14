<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import AppRow from "./AppRow.svelte";
    import AppSheet from "./AppSheet.svelte";
    import { shortLink } from "./GitHub";
    import { IconCopy, IconKey } from "@wa-icons";

    /**
     * "Waiting for acme-corp" (game #2041): an organization that only lets in apps its owner allows. GitHub already sent the
     * person's request to its owners; this says so, gives the install link to send them too, and offers the person's own key as
     * the way that needs no wait.
     */
    export let account: string;
    export let installUrl: string;
    export let onUseKey: () => void;
    export let onClose: () => void;

    $: text = $LL.chat.brick.apps.github;
    let copied = false;

    async function copy() {
        try {
            await navigator.clipboard.writeText(installUrl);
            copied = true;
        } catch (error) {
            console.warn("Could not copy the link", error);
        }
    }
</script>

<AppSheet
    title={text.waitingTitle({ account })}
    sub={text.waitingLine({ account })}
    {onClose}
    testId="gitHubWaitingSheet"
>
    <p class="lb">{text.sendLink()}</p>
    <div class="fd" data-testid="gitHubInstallLink">{shortLink(installUrl)}</div>
    <div>
        <PageButton tall testId="gitHubCopyLink" on:click={() => void copy()}
            ><IconCopy font-size="16" />{copied ? text.copied() : text.copyLink()}</PageButton
        >
    </div>
    <AppRow
        title={text.cantWait()}
        hint={text.cantWaitLine()}
        icon={IconKey}
        onTap={onUseKey}
        testId="gitHubCantWait"
    />
    <svelte:fragment slot="buttons">
        <PageButton tall go testId="gitHubWaitingDone" on:click={onClose}>{text.done()}</PageButton>
    </svelte:fragment>
</AppSheet>

<style>
    .lb {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: rgba(244, 242, 250, 0.82);
    }
    .fd {
        padding: 12px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        color: #fff;
        overflow-wrap: anywhere;
    }
</style>
