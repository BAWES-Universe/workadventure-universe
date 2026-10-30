<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import type { ChatArtifact } from "../../Artifacts/ArtifactApi";
    import { YOUR_ARTIFACTS_ICON, YOUR_ARTIFACTS_ICON_BACKGROUND } from "../../Artifacts/artifactBadge";
    import { yourArtifactsList } from "../../Artifacts/chatArtifactsList";
    import ArtifactRow from "../../Chat/Components/Room/Details/ArtifactRow.svelte";
    import { sharedSectionOf, type SharedSection } from "../../Chat/Components/Room/Details/SharedItems";
    import OpenHereRow from "../EmbedScreens/OpenHereRow.svelte";
    import OpenHereItemIcon from "../EmbedScreens/OpenHereItemIcon.svelte";
    import { IconLoader } from "@wa-icons";

    /**
     * Your artifacts in the window (game #1609): every one you own, from every bot and chat, newest change first under
     * the same week and month headings as a chat's Artifacts page, with the same rows plus the bot that made each. A tap
     * opens it as its own item beside this one; one that is open is soft violet. The next ones load at the end.
     */
    export let visible: boolean;

    const list = yourArtifactsList();
    const now = new Date();

    function label(section: SharedSection): string {
        switch (section.kind) {
            case "thisWeek":
                return $LL.chat.details.sections.thisWeek();
            case "lastWeek":
                return $LL.chat.details.sections.lastWeek();
            case "thisMonth":
                return $LL.chat.details.sections.thisMonth();
            case "month":
                return new Date(section.year, section.month, 1).toLocaleDateString($locale, {
                    month: "long",
                    ...(section.year !== now.getFullYear() ? { year: "numeric" } : {}),
                });
            case "undated":
                return $LL.chat.details.sections.undated();
        }
    }

    $: sections = $list.artifacts.reduce<{ label: string; items: ChatArtifact[] }[]>((all, artifact) => {
        const name = label(sharedSectionOf(new Date(artifact.updatedAt), now));
        const same = all.find((one) => one.label === name);
        if (same) same.items.push(artifact);
        else all.push({ label: name, items: [artifact] });
        return all;
    }, []);

    function more() {
        list.loadMore().catch((error) => console.error(error));
    }

    // The next page as the end of the list comes into view; the button stays for when it doesn't (or failed)
    let sentinel: HTMLDivElement | undefined;
    let observer: IntersectionObserver | undefined;
    onMount(() => {
        if (!$list.loaded && !$list.loading) list.refresh().catch((error) => console.error(error));
        if (typeof IntersectionObserver === "undefined") return;
        observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting) && !$list.failed) more();
        });
    });
    $: if (observer) {
        observer.disconnect();
        if (sentinel) observer.observe(sentinel);
    }
    onDestroy(() => observer?.disconnect());
</script>

<div class="your-artifacts" class:hidden={!visible} data-testid="yourArtifacts">
    <OpenHereRow name={$LL.chat.artifacts.yours()} line={$LL.chat.artifacts.yoursLine({ count: $list.total })}>
        <span slot="icon"
            ><OpenHereItemIcon src={YOUR_ARTIFACTS_ICON} background={YOUR_ARTIFACTS_ICON_BACKGROUND} /></span
        >
    </OpenHereRow>
    <div class="list">
        {#each sections as section (section.label)}
            <section class="flex flex-col gap-1">
                <h3 class="shared-heading">{section.label}</h3>
                <div class="shared-group">
                    {#each section.items as artifact (artifact.id)}
                        <ArtifactRow {artifact} showMaker />
                    {/each}
                </div>
            </section>
        {/each}

        {#if $list.loaded && $list.artifacts.length === 0 && !$list.failed}
            <p class="py-10 text-center text-sm text-white/50" data-testid="yourArtifactsEmpty">
                {$LL.chat.details.artifactsEmpty()}
            </p>
        {/if}

        {#if $list.loading}
            <div class="flex items-center justify-center gap-2 py-3 text-xs text-white/60" role="status">
                <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={16} />
            </div>
        {:else if $list.failed}
            <div class="flex flex-col items-center gap-2 py-3 text-sm text-white/60" data-testid="yourArtifactsFailed">
                {$LL.chat.details.artifactsFailed()}
                <button type="button" class="u-menu-row !m-0 w-full justify-center" on:click={() => list.retry()}>
                    {$LL.chat.artifacts.tryAgain()}
                </button>
            </div>
        {:else if $list.next !== null}
            <div bind:this={sentinel}>
                <button
                    type="button"
                    class="u-menu-row !m-0 w-full justify-center"
                    data-testid="yourArtifactsMore"
                    on:click={more}
                >
                    {$LL.chat.details.artifactsMore()}
                </button>
            </div>
        {/if}
    </div>
</div>

<style>
    .your-artifacts {
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
    /* Under the row, as an artifact's page sits under its row */
    .list {
        flex: 1;
        min-height: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px 16px 16px;
        overflow-y: auto;
        background: #0a0814;
    }
    .shared-heading {
        margin: 0.25rem 0 0;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
    }
    .shared-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
</style>
