<script lang="ts">
    import { onDestroy } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import type { ArtifactCoWebsite } from "../../WebRtc/CoWebsite/ArtifactCoWebsite";
    import {
        ArtifactRequestError,
        fetchArtifact,
        fetchArtifactCode,
        fetchArtifactVersions,
        type ArtifactVersionInfo,
        type OpenedArtifact,
    } from "../../Artifacts/ArtifactApi";
    import { artifactBadge } from "../../Artifacts/artifactBadge";
    import type { ArtifactKind } from "../../Artifacts/artifactCard";
    import { whenLabel } from "../../Artifacts/whenLabel";
    import { renderMarkdown } from "../../FileViewer/textFiles";
    import OpenHereRow from "../EmbedScreens/OpenHereRow.svelte";
    import OpenHereItemIcon from "../EmbedScreens/OpenHereItemIcon.svelte";
    import { IconAlertTriangle, IconCode, IconEye, IconHistory, IconLoader, IconRefresh } from "@wa-icons";

    export let actualCowebsite: ArtifactCoWebsite;
    export let visible: boolean;

    /** Below this panel width (a phone) the row keeps to Versions and Code, and the versions open as a sheet. */
    const COMPACT_WIDTH = 440;
    /** The most lines of code drawn at once; a mini app is one file, so this is only a guard. */
    const MAX_CODE_LINES = 4000;

    const id = actualCowebsite.artifactId;
    const versionStore = actualCowebsite.version;
    const summaryStore = actualCowebsite.summary;

    let panelWidth = 0;
    let phase: "opening" | "ready" | "failed" = "opening";
    let failure: "gone" | "offline" = "offline";
    let opened: OpenedArtifact | undefined;
    let versions: ArtifactVersionInfo[] | undefined;
    let versionsFailed = false;
    /** Another version was asked for and could not be opened; the one that was showing stays. */
    let switchFailed = false;
    let menuOpen = false;
    let codeOn = false;
    let text: { number: number; content: string } | undefined;
    let textFailed = false;
    let request = 0;
    /** The version showing now; what the version asked for is compared with. Counts the tries to open again. */
    let shownNumber: number | undefined;
    let attempt = 0;
    let destroyed = false;

    onDestroy(() => {
        destroyed = true;
    });

    $: compact = panelWidth > 0 && panelWidth < COMPACT_WIDTH;
    $: kind = (opened?.artifact.kind ?? $summaryStore.kind) as ArtifactKind | undefined;
    $: makerName = opened?.artifact.makerName ?? $summaryStore.makerName ?? "";
    $: title = opened?.artifact.title ?? $summaryStore.title;
    $: shown = opened?.version;
    $: latest = opened?.artifact.version ?? 0;
    $: isLatest = shown !== undefined && shown.number === latest;
    $: line = shown
        ? isLatest
            ? $LL.chat.artifacts.byVersion({ maker: makerName, version: shown.number })
            : $LL.chat.artifacts.byVersionOf({ maker: makerName, version: shown.number, count: latest })
        : makerName
        ? $LL.chat.artifacts.by({ maker: makerName })
        : "";
    $: badge = artifactBadge(kind, $LL);
    // A document is drawn from its text, a drawing as a picture, a page or app in the locked frame.
    $: needsText = codeOn || kind === "markdown";

    // Open when the window starts, and again whenever a version other than the one showing is asked for.
    $: syncVersion($versionStore, attempt);
    $: if (phase === "ready" && opened && needsText) ensureText(opened.version.number);

    function syncVersion(wanted: number | undefined, _attempt: number) {
        if (shownNumber !== undefined && (wanted === undefined || wanted === shownNumber)) return;
        void load(wanted);
    }

    function ensureText(number: number) {
        if (text?.number === number || textFailed) return;
        void loadText(number);
    }

    async function load(version: number | undefined) {
        const mine = ++request;
        switchFailed = false;
        phase = "opening";
        try {
            const answer = await fetchArtifact(id, actualCowebsite.chat, version);
            if (destroyed || mine !== request) return;
            opened = answer;
            shownNumber = answer.version.number;
            text = undefined;
            textFailed = false;
            summaryStore.set({
                title: answer.artifact.title,
                kind: answer.artifact.kind as ArtifactKind,
                makerName: answer.artifact.makerName,
            });
            // What the window shows is now a concrete version, so a card for it can show as open.
            if ($versionStore !== answer.version.number) versionStore.set(answer.version.number);
            phase = "ready";
        } catch (error) {
            if (destroyed || mine !== request) return;
            failure = error instanceof ArtifactRequestError && error.status === 404 ? "gone" : "offline";
            if (opened) {
                // Another version could not be opened: keep the one showing, and say so.
                switchFailed = true;
                versionStore.set(opened.version.number);
                phase = "ready";
                return;
            }
            phase = "failed";
        }
    }

    async function loadText(number: number) {
        try {
            const answer = await fetchArtifactCode(id, number, actualCowebsite.chat);
            if (destroyed || opened?.version.number !== number) return;
            text = { number, content: answer.content };
        } catch (error) {
            console.warn("Could not read an artifact's text", error);
            if (!destroyed) textFailed = true;
        }
    }

    function retry() {
        opened = undefined;
        shownNumber = undefined;
        textFailed = false;
        phase = "opening";
        attempt++;
    }

    async function toggleVersions() {
        menuOpen = !menuOpen;
        if (!menuOpen) return;
        versionsFailed = false;
        try {
            versions = await fetchArtifactVersions(id, actualCowebsite.chat);
        } catch (error) {
            console.warn("Could not list an artifact's versions", error);
            versionsFailed = true;
        }
    }

    function pickVersion(number: number) {
        menuOpen = false;
        versionStore.set(number);
    }

    function backToLatest() {
        versionStore.set(latest);
    }

    function toggleCode() {
        codeOn = !codeOn;
        textFailed = false;
    }

    $: codeLines = text ? text.content.split("\n") : [];
    $: codeShown =
        codeLines.length > MAX_CODE_LINES ? codeLines.slice(0, MAX_CODE_LINES).join("\n") : text?.content ?? "";
    $: documentHtml = kind === "markdown" && text ? renderMarkdown(text.content) : "";
</script>

<div class="artifact" class:hidden={!visible} bind:clientWidth={panelWidth} data-testid="artifactPanel">
    <OpenHereRow name={title} {line}>
        <span slot="icon"><OpenHereItemIcon {badge} /></span>
        {#if phase === "ready" && opened}
            <button
                type="button"
                class="open-here-action"
                class:picked={menuOpen}
                title={$LL.chat.artifacts.versions()}
                aria-label={$LL.chat.artifacts.versions()}
                aria-expanded={menuOpen}
                data-testid="artifactVersions"
                on:click={toggleVersions}><IconHistory font-size="22" /></button
            >
            {#if !compact}
                <button
                    type="button"
                    class="open-here-action"
                    class:picked={codeOn}
                    title={codeOn ? $LL.chat.artifacts.preview() : $LL.chat.artifacts.code()}
                    aria-label={codeOn ? $LL.chat.artifacts.preview() : $LL.chat.artifacts.code()}
                    aria-pressed={codeOn}
                    data-testid="artifactCode"
                    on:click={toggleCode}
                >
                    {#if codeOn}<IconEye font-size="22" />{:else}<IconCode font-size="22" />{/if}
                </button>
            {/if}
        {/if}
    </OpenHereRow>

    {#if phase === "ready" && opened && !isLatest}
        <div class="old-note" data-testid="artifactOldNote">
            <span>{$LL.chat.artifacts.oldVersionNote({ version: opened.version.number, latest })}</span>
            <span class="old-actions">
                <button type="button" class="quiet" on:click={backToLatest}>{$LL.chat.artifacts.backToLatest()}</button>
            </span>
        </div>
    {/if}

    {#if switchFailed}
        <div class="old-note" role="alert" data-testid="artifactSwitchFailed">
            <span>{failure === "gone" ? $LL.chat.artifacts.cantOpen() : $LL.chat.artifacts.cantReach()}</span>
        </div>
    {/if}

    <div class="stage">
        {#if phase === "opening" && !opened}
            <div class="state" role="status">
                <IconLoader font-size="28" class="spin" />
                <span>{$LL.chat.artifacts.opening()}</span>
            </div>
        {:else if phase === "failed"}
            <div class="state" role="alert">
                <IconAlertTriangle font-size="28" />
                <b>{failure === "gone" ? $LL.chat.artifacts.cantOpen() : $LL.chat.artifacts.cantReach()}</b>
                <span
                    >{failure === "gone" ? $LL.chat.artifacts.cantOpenHelp() : $LL.chat.artifacts.cantReachHelp()}</span
                >
                {#if failure === "offline"}
                    <button type="button" class="quiet" on:click={retry}
                        ><IconRefresh font-size="16" /> {$LL.chat.artifacts.tryAgain()}</button
                    >
                {/if}
            </div>
        {:else if opened}
            {#if codeOn}
                <div class="code" data-testid="artifactCodeView">
                    {#if text}
                        <div class="code-head">{$LL.chat.artifacts.codeLines({ count: codeLines.length })}</div>
                        <pre><code>{codeShown}</code></pre>
                        {#if codeLines.length > MAX_CODE_LINES}<p class="cut">{$LL.chat.artifacts.codeCut()}</p>{/if}
                    {:else if textFailed}
                        <div class="state" role="alert">
                            <b>{$LL.chat.artifacts.cantReach()}</b>
                            <button type="button" class="quiet" on:click={toggleCode}
                                >{$LL.chat.artifacts.tryAgain()}</button
                            >
                        </div>
                    {:else}
                        <div class="state" role="status"><IconLoader font-size="28" class="spin" /></div>
                    {/if}
                </div>
            {:else if kind === "markdown"}
                <div class="document" data-testid="artifactDocument">
                    {#if text}
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html documentHtml}
                    {:else if textFailed}
                        <div class="state" role="alert"><b>{$LL.chat.artifacts.cantReach()}</b></div>
                    {:else}
                        <div class="state" role="status"><IconLoader font-size="28" class="spin" /></div>
                    {/if}
                </div>
            {:else if kind === "svg"}
                <!-- A picture cannot run anything, whatever the drawing holds. -->
                <img class="drawing" src={opened.version.url} alt={title} referrerpolicy="no-referrer" />
            {:else}
                <!-- The locked box: its scripts run, but the page has no origin of its own, no network except common
                     libraries, and no way into the game. The address is outside the game's own. -->
                <iframe
                    title={$LL.chat.artifacts.frameTitle({ title, maker: makerName })}
                    src={opened.version.url}
                    sandbox="allow-scripts allow-forms"
                    referrerpolicy="no-referrer"
                    allow=""
                    data-testid="artifactFrame"
                />
            {/if}
        {/if}
    </div>

    {#if menuOpen}
        <div class="menu" class:in-sheet={compact} data-testid="artifactVersionMenu">
            {#if compact}<span class="grab" />{/if}
            <b class="menu-title">{$LL.chat.artifacts.versions()}</b>
            {#if versionsFailed}
                <p class="menu-note">{$LL.chat.artifacts.cantReach()}</p>
            {:else if !versions}
                <p class="menu-note">{$LL.chat.artifacts.loadingVersions()}</p>
            {:else}
                {#each versions as version (version.number)}
                    <button
                        type="button"
                        class="menu-row"
                        class:picked={opened?.version.number === version.number}
                        on:click={() => pickVersion(version.number)}
                    >
                        <span class="vnum">{version.number}</span>
                        <span class="menu-text">
                            <b>
                                {version.number === latest
                                    ? $LL.chat.artifacts.versionLatest({ version: version.number })
                                    : $LL.chat.artifacts.versionRow({ version: version.number })}
                            </b>
                            {#if version.summary}<small>{version.summary}</small>{/if}
                            <small>
                                {version.askedByName
                                    ? $LL.chat.artifacts.askedAt({
                                          name: version.askedByName,
                                          time: whenLabel(version.createdAt),
                                      })
                                    : $LL.chat.artifacts.madeAt({ time: whenLabel(version.createdAt) })}
                            </small>
                        </span>
                    </button>
                {/each}
                <p class="menu-note">{$LL.chat.artifacts.versionsNote()}</p>
            {/if}
        </div>
    {/if}
</div>

<style>
    .artifact {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        color: #fff;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .hidden {
        display: none;
    }
    .stage {
        position: relative;
        flex: 1;
        min-height: 0;
        background: #0a0814;
        overflow: auto;
    }
    iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #0a0814;
    }
    .drawing {
        display: block;
        max-width: 100%;
        max-height: 100%;
        margin: 0 auto;
        padding: 12px;
        box-sizing: border-box;
    }
    .document {
        padding: 16px;
        font-size: 15px;
        line-height: 1.55;
        overflow-wrap: anywhere;
    }
    /* The game's own heading styles are big and capital; a document reads like a document. */
    .document :global(h1),
    .document :global(h2),
    .document :global(h3),
    .document :global(h4) {
        margin: 1.2em 0 0.4em;
        font-family: inherit;
        font-weight: 700;
        line-height: 1.25;
        text-transform: none;
        letter-spacing: 0;
    }
    .document :global(h1) {
        font-size: 24px;
    }
    .document :global(h2) {
        font-size: 20px;
    }
    .document :global(h3),
    .document :global(h4) {
        font-size: 16px;
    }
    .document :global(:first-child) {
        margin-top: 0;
    }
    .document :global(p),
    .document :global(ul),
    .document :global(ol),
    .document :global(blockquote),
    .document :global(pre) {
        margin: 0 0 0.8em;
    }
    .document :global(pre) {
        padding: 10px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        overflow: auto;
    }
    .document :global(code) {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
    }
    .document :global(a) {
        color: #c4b5fd;
    }
    .state {
        height: 100%;
        min-height: 160px;
        box-sizing: border-box;
        padding: 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        text-align: center;
        color: rgba(255, 255, 255, 0.75);
    }
    .state b {
        color: #fff;
        font-size: 16px;
    }
    .state span {
        max-width: 36ch;
        font-size: 14px;
    }
    .state :global(.spin) {
        animation: artifact-spin 1s linear infinite;
    }
    @keyframes artifact-spin {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .state :global(.spin) {
            animation: none;
        }
    }
    .old-note {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 10px;
        padding: 8px 12px;
        font-size: 13px;
        background: rgba(134, 41, 252, 0.14);
        border-bottom: 1px solid rgba(167, 139, 250, 0.35);
    }
    .old-note > span:first-child {
        flex: 1;
        min-width: 180px;
    }
    .old-actions {
        display: flex;
        gap: 6px;
    }
    .quiet {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        padding: 0 16px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font: 600 13px inherit;
        font-family: inherit;
        cursor: pointer;
    }
    .quiet:focus-visible,
    .menu-row:focus-visible {
        outline: 2px solid #c4b5fd;
        outline-offset: 2px;
    }
    .code {
        min-height: 100%;
        background: #0f0c19;
    }
    .code-head {
        position: sticky;
        top: 0;
        padding: 8px 12px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
        background: #0f0c19;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    pre {
        margin: 0;
        padding: 12px;
        font-family: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: rgba(255, 255, 255, 0.9);
    }
    .cut {
        margin: 0;
        padding: 0 12px 12px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
    }
    .menu {
        position: absolute;
        top: 60px;
        inset-inline-end: 8px;
        z-index: 5;
        box-sizing: border-box;
        width: min(340px, calc(100% - 16px));
        max-height: calc(100% - 76px);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px;
        border-radius: 18px;
        background: linear-gradient(160deg, rgb(31 28 47 / 0.98), rgb(20 18 30 / 0.99));
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(167, 139, 250, 0.18),
            0 18px 40px rgb(0 0 0 / 0.5);
    }
    .menu.in-sheet {
        top: auto;
        bottom: 0;
        inset-inline: 0;
        width: auto;
        max-height: 70%;
        padding: 8px 16px 24px;
        border-radius: 24px 24px 0 0;
    }
    .grab {
        width: 36px;
        height: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.3);
        margin: 4px auto 8px;
    }
    .menu-title {
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.6);
        padding: 6px 6px 2px;
    }
    .menu-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        min-height: 48px;
        padding: 8px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        color: #fff;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .menu-row:hover {
        background: rgba(255, 255, 255, 0.08);
    }
    .menu-row.picked {
        background: rgba(134, 41, 252, 0.14);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .vnum {
        flex: none;
        width: 32px;
        height: 32px;
        border-radius: 10px;
        display: grid;
        place-items: center;
        font-weight: 700;
        font-size: 14px;
        background: rgba(255, 255, 255, 0.08);
    }
    .menu-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.3;
    }
    .menu-text b {
        font-size: 14px;
    }
    .menu-text small {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
    }
    .menu-note {
        margin: 4px 6px 2px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.55);
    }
</style>
