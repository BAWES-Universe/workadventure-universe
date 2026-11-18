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
        type FileSection,
    } from "./BrickFiles";
    import { shortDay } from "./Brick";
    import { IconChevronRight, IconFile, IconFileText, IconFolder, IconPhoto, IconSearch } from "@wa-icons";
    import "./BrickGroups.css";

    /**
     * Files on a Brick's page (game #2003): what it made for the person, what they sent it, and what is on its computer
     * once it has one. The page can look and download; the one change is deleting a file the person sent. Opening this
     * never starts a computer: what is on one comes from Orbit's last reading of it, with its date.
     *
     * Both lists show the newest files and go on, page by page, to the oldest: nothing is out of reach however many
     * files there are. Search looks at the name of every file, not only the ones loaded. "Download all" reads every page
     * of both lists (the files found, while a search is shown), so the zip is the whole of what its button says.
     */
    export let brickId: string;
    export let name: string;
    export let open = false;
    export let onToggle: (id: string) => void;
    /** Opens the computer's own files (#2000). Without it the page offers no browsing. */
    export let onBrowse: (() => void) | undefined = undefined;

    const list = brickFilesList(brickId);
    const { files, state, query, search, loadingMore } = list;
    let zipping = false;
    // What is typed in the search, and the wait before it is sent: a search goes out when typing pauses, not on every key
    let typed = "";
    let waiting: ReturnType<typeof setTimeout> | undefined;
    // Set once a list has been longer than what it showed, and kept: the search must not vanish while it is being used
    let long = false;

    const size = (bytes: number) => fileSize(bytes, get(locale));
    $: brief =
        $state !== "ready"
            ? ""
            : $files.count === 0
            ? $LL.chat.brick.files.briefNone()
            : $files.bytes > 0
            ? $LL.chat.brick.files.briefSize({ count: $files.count, size: size($files.bytes) })
            : $LL.chat.brick.files.brief({ count: $files.count });
    $: artifacts = $files.made.artifacts;
    $: searching = $query !== "" || $search !== "idle";
    $: foundCount = $files.made.fileTotal + $files.sent.total;
    $: exportCount = searching ? foundCount : $files.count;
    $: if ($files.made.nextCursor !== null || $files.sent.nextCursor !== null) long = true;
    $: computer = $files.computer;
    // What is left is whatever Orbit has a next page for: a file that was left out of a page (not whole) or already shown
    // never keeps "Show older files" on the page once there is no next page
    $: madeLeft = $files.made.nextCursor === null ? 0 : Math.max(1, $files.made.fileTotal - $files.made.files.length);
    $: sentLeft = $files.sent.nextCursor === null ? 0 : Math.max(1, $files.sent.total - $files.sent.files.length);

    onMount(() => {
        list.load().catch((error) => console.error(error));
        return () => clearTimeout(waiting);
    });

    function typing() {
        clearTimeout(waiting);
        waiting = setTimeout(() => {
            list.find(typed).catch((error) => console.error(error));
        }, 300);
    }
    function more(section: FileSection) {
        list.more(section)
            .then((done) => {
                if (!done) warningMessageStore.addWarningMessage($LL.chat.brick.files.moreFailed());
            })
            .catch((error) => console.error(error));
    }

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
        // Every page of both lists, read as the zip is put together
        downloadEverything(list.everyFile(), `${name}-files.zip`)
            .then((done) => {
                if (!done) warningMessageStore.addWarningMessage($LL.chat.brick.files.everythingFailed());
                // The list stopped coming part of the way, or some files could not be read: the person must not take
                // the zip for all of it
                else if (!done.complete)
                    warningMessageStore.addWarningMessage($LL.chat.brick.files.everythingListCut());
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
            {#if long || searching}
                <label class="bkg-search" data-testid="filesSearch">
                    <IconSearch font-size="18" />
                    <input
                        type="search"
                        bind:value={typed}
                        on:input={typing}
                        placeholder={$LL.chat.brick.files.search()}
                        aria-label={$LL.chat.brick.files.search()}
                        data-testid="filesSearchInput"
                    />
                </label>
            {/if}
            {#if $search === "searching"}
                <p class="bkg-note" data-testid="filesSearching">
                    <span>{$LL.chat.brick.files.searching({ words: typed.trim() })}</span>
                </p>
            {:else if $search === "failed"}
                <div class="bkg-retry">
                    <p class="bkg-lead">{$LL.chat.brick.files.searchFailed()}</p>
                    <PageButton tall testId="filesSearchRetry" on:click={() => list.find(typed)}
                        >{$LL.chat.brick.memory.retry()}</PageButton
                    >
                </div>
            {:else}
                {#if $query !== ""}
                    <p class="bkg-note" data-testid="filesFound">
                        <span
                            >{foundCount === 0
                                ? $LL.chat.brick.files.nothingFound({ words: $query })
                                : $LL.chat.brick.files.found({ count: foundCount, words: $query })}</span
                        >
                    </p>
                {/if}
                {#if !searching || $files.made.files.length > 0 || madeLeft > 0}
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
                    {#if madeLeft > 0}
                        <div class="bkg-more" data-testid="filesMoreMade">
                            <PageButton
                                tall
                                testId="filesMoreMadeButton"
                                disabled={$loadingMore.has("made")}
                                on:click={() => more("made")}>{$LL.chat.brick.files.showMore()}</PageButton
                            >
                            <span class="bkg-cn">{$LL.chat.brick.files.showMoreLine({ count: madeLeft })}</span>
                        </div>
                    {/if}
                    {#if artifacts > 0 && !searching}
                        <button type="button" class="bkg-tap" data-testid="filesAllMade" on:click={openYourArtifacts}>
                            <span class="bkg-ico" />
                            <span class="bkg-mtx">
                                <span class="bkg-t">{$LL.chat.brick.files.artifactsMade({ count: artifacts })}</span>
                                <span class="bkg-cn">{$LL.chat.brick.files.opensArtifacts()}</span>
                            </span>
                            <IconChevronRight class="bkg-go" font-size="18" />
                        </button>
                    {:else if $files.made.files.length === 0 && !searching}
                        <p class="bkg-note" data-testid="filesNoneMade">
                            <span>{$LL.chat.brick.files.noneMade({ name })}</span>
                        </p>
                    {/if}
                {/if}

                {#if !searching || $files.sent.files.length > 0 || sentLeft > 0}
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
                        {#if !searching}
                            <p class="bkg-note" data-testid="filesNoneSent">
                                <span>{$LL.chat.brick.files.noneSent({ name })}</span>
                            </p>
                        {/if}
                    {/each}
                    {#if sentLeft > 0}
                        <div class="bkg-more" data-testid="filesMoreSent">
                            <PageButton
                                tall
                                testId="filesMoreSentButton"
                                disabled={$loadingMore.has("sent")}
                                on:click={() => more("sent")}>{$LL.chat.brick.files.showMore()}</PageButton
                            >
                            <span class="bkg-cn">{$LL.chat.brick.files.showMoreLine({ count: sentLeft })}</span>
                        </div>
                    {/if}
                {/if}

                {#if computer && !searching}
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

                {#if exportCount > 0}
                    <div class="bkg-off">
                        <PageButton tall disabled={zipping} testId="filesDownloadAll" on:click={downloadAll}
                            >{searching
                                ? $LL.chat.brick.files.everythingFound({ count: exportCount })
                                : $LL.chat.brick.files.everything({ count: exportCount })}</PageButton
                        >
                        <span class="bkg-cn"
                            >{searching
                                ? $LL.chat.brick.files.everythingFoundLine()
                                : computer
                                ? $LL.chat.brick.files.everythingLineComputer({ name })
                                : $LL.chat.brick.files.everythingLine({ name })}</span
                        >
                    </div>
                {/if}
            {/if}
        {/if}
    </div>
</PageGroup>
