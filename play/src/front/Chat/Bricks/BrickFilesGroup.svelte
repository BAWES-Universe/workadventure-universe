<script lang="ts">
    import { onMount } from "svelte";
    import { get } from "svelte/store";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import { openYourArtifacts } from "../../Artifacts/openYourArtifacts";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import PageGroup from "../../external-modules/bots/components/page/PageGroup.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import {
        brickFilesList,
        downloadEverything,
        downloadFile,
        fileIconKind,
        fileSize,
        type BrickFile,
    } from "./BrickFiles";
    import { shortDay } from "./Brick";
    import { IconChevronRight, IconFile, IconFileText, IconFolder, IconPhoto } from "@wa-icons";
    import "./BrickGroups.css";

    /**
     * Files on a Brick's page (game #2003): what it made for the person, what they sent it, and what is on its computer
     * once it has one. The page can look and download; the one change is deleting a file the person sent. Opening this
     * never starts a computer: what is on one comes from Orbit's last reading of it, with its date.
     */
    export let brickId: string;
    export let name: string;
    export let open = false;
    export let onToggle: (id: string) => void;
    /** Opens the computer's own files (#2000). Without it the page offers no browsing. */
    export let onBrowse: (() => void) | undefined = undefined;

    const list = brickFilesList(brickId);
    const { files, state } = list;
    let zipping = false;

    const size = (bytes: number) => fileSize(bytes, get(locale));
    $: brief =
        $state !== "ready"
            ? ""
            : $files.count === 0
            ? $LL.chat.brick.files.briefNone()
            : $files.bytes > 0
            ? $LL.chat.brick.files.briefSize({ count: $files.count, size: size($files.bytes) })
            : $LL.chat.brick.files.brief({ count: $files.count });
    $: moreMade = $files.made.total > $files.made.files.length;
    $: everything = [...$files.made.files, ...$files.sent.files];
    $: computer = $files.computer;

    onMount(() => {
        list.load().catch((error) => console.error(error));
    });

    function day(at: number): string {
        return shortDay(at, $locale);
    }
    function noteOf(file: BrickFile, withWho: boolean): string {
        const parts = [day(file.at), ...(file.sizeBytes !== null ? [size(file.sizeBytes)] : [])];
        if (withWho) {
            parts.push(
                file.audience === "you"
                    ? $LL.chat.brick.files.onlyYouAndBrick({ name })
                    : $LL.chat.brick.files.inNearbyChat()
            );
        }
        return parts.join(" · ");
    }
    function icon(file: BrickFile) {
        const kind = fileIconKind(file);
        return kind === "image" ? IconPhoto : kind === "sheet" ? IconFileText : IconFile;
    }

    function download(file: BrickFile) {
        if (!downloadFile(file)) warningMessageStore.addWarningMessage($LL.chat.brick.files.downloadFailed());
    }

    function remove(file: BrickFile) {
        list.deleteSent(file.id)
            .then((gone) => {
                if (!gone) warningMessageStore.addWarningMessage($LL.chat.brick.files.deleteFailed());
            })
            .catch((error) => console.error(error));
    }

    function downloadAll() {
        if (zipping) return;
        zipping = true;
        downloadEverything(everything, `${name}-files.zip`)
            .then((done) => {
                if (!done) warningMessageStore.addWarningMessage($LL.chat.brick.files.everythingFailed());
                // Some went in and some did not: the person must not take the zip for all of it
                else if (done.missed > 0)
                    warningMessageStore.addWarningMessage($LL.chat.brick.files.everythingPartial());
            })
            .catch((error) => {
                console.error(error);
                warningMessageStore.addWarningMessage($LL.chat.brick.files.everythingFailed());
            })
            .finally(() => {
                zipping = false;
            });
    }
</script>

<PageGroup id="files" icon={IconFolder} title={$LL.chat.brick.files.title()} {brief} {open} {onToggle}>
    <div class="bkg" data-testid="brickFiles">
        {#if $state === "failed"}
            <div class="bkg-retry">
                <p class="bkg-lead">{$LL.chat.brick.files.loadFailed()}</p>
                <PageButton testId="filesRetry" on:click={() => list.load()}>{$LL.chat.brick.memory.retry()}</PageButton
                >
            </div>
        {:else if $state === "ready"}
            <div class="bkg-cap">{$LL.chat.brick.files.made()}</div>
            {#each $files.made.files as file (file.id)}
                <div class="bkg-tap" data-testid="filesMadeRow">
                    <span class="bkg-ico"><svelte:component this={icon(file)} font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{file.name}</span>
                        <span class="bkg-cn">{noteOf(file, false)}</span>
                    </span>
                    <PageButton testId="filesDownload" on:click={() => download(file)}
                        >{$LL.chat.brick.files.download()}</PageButton
                    >
                </div>
            {/each}
            {#if moreMade}
                <button type="button" class="bkg-tap" data-testid="filesAllMade" on:click={openYourArtifacts}>
                    <span class="bkg-ico" />
                    <span class="bkg-mtx">
                        <span class="bkg-t">{$LL.chat.brick.files.allMade({ count: $files.made.total })}</span>
                        <span class="bkg-cn">{$LL.chat.brick.files.opensArtifacts()}</span>
                    </span>
                    <IconChevronRight class="bkg-go" font-size="18" />
                </button>
            {:else if $files.made.files.length === 0}
                <p class="bkg-note" data-testid="filesNoneMade">
                    <span>{$LL.chat.brick.files.noneMade({ name })}</span>
                </p>
            {/if}

            <div class="bkg-cap gap">{$LL.chat.brick.files.sent()}</div>
            {#each $files.sent.files as file (file.id)}
                <div class="bkg-tap" data-testid="filesSentRow">
                    <span class="bkg-ico"><svelte:component this={icon(file)} font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{file.name}</span>
                        <span class="bkg-cn">{noteOf(file, true)}</span>
                        <span class="bkg-acts">
                            <PageButton testId="filesSentDownload" on:click={() => download(file)}
                                >{$LL.chat.brick.files.download()}</PageButton
                            >
                            <PageButton testId="filesDelete" on:click={() => remove(file)}
                                >{$LL.chat.brick.files.delete()}</PageButton
                            >
                        </span>
                    </span>
                </div>
            {:else}
                <p class="bkg-note" data-testid="filesNoneSent">
                    <span>{$LL.chat.brick.files.noneSent({ name })}</span>
                </p>
            {/each}

            {#if computer}
                {#if computer.state === "on"}
                    {#if onBrowse}
                        <div class="bkg-cap gap">{$LL.chat.brick.files.onItsComputer()}</div>
                        <button type="button" class="bkg-tap" data-testid="filesBrowse" on:click={onBrowse}>
                            <span class="bkg-ico"><IconFolder font-size="20" /></span>
                            <span class="bkg-mtx">
                                <span class="bkg-t">{$LL.chat.brick.files.browse()}</span>
                                <span class="bkg-cn">{size(computer.bytes)}</span>
                            </span>
                            <IconChevronRight class="bkg-go" font-size="18" />
                        </button>
                    {/if}
                {:else}
                    <div class="bkg-cap gap">{$LL.chat.brick.files.fromItsComputerOff()}</div>
                    <div class="bkg-tap" data-testid="filesLastCopy">
                        <span class="bkg-ico"><IconFolder font-size="20" /></span>
                        <span class="bkg-mtx">
                            <span class="bkg-t">{$LL.chat.brick.files.lastCopy()}</span>
                            <span class="bkg-cn"
                                >{$LL.chat.brick.files.lastCopyLine({
                                    date: computer.savedAt !== null ? day(computer.savedAt) : "",
                                    size: size(computer.bytes),
                                })}</span
                            >
                        </span>
                    </div>
                    <p class="bkg-note"><span>{$LL.chat.brick.files.looking()}</span></p>
                {/if}
            {/if}

            {#if everything.length > 0}
                <div class="bkg-off">
                    <PageButton tall disabled={zipping} testId="filesDownloadAll" on:click={downloadAll}
                        >{$LL.chat.brick.files.everything()}</PageButton
                    >
                    <span class="bkg-cn">{$LL.chat.brick.files.everythingLine()}</span>
                </div>
            {/if}
        {/if}
    </div>
</PageGroup>
