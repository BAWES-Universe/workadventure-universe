<script lang="ts">
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import { coWebsites } from "../../../../Stores/CoWebsiteStore";
    import { ArtifactCoWebsite } from "../../../../WebRtc/CoWebsite/ArtifactCoWebsite";
    import type { ArtifactChat, ChatArtifact } from "../../../../Artifacts/ArtifactApi";
    import { artifactBadge, artifactKindName } from "../../../../Artifacts/artifactBadge";
    import { artifactKindOf } from "../../../../Artifacts/artifactCard";
    import { openArtifactFromCard } from "../../../../Artifacts/openArtifact";
    import { sentLabel } from "./SharedItems";

    /**
     * An artifact made in the chat, as a file row (game #1474): its type tile, title, kind, version, whose it is when it
     * isn't yours, and when it last changed. A tap opens its latest version in the window, as its card does.
     */
    export let artifact: ChatArtifact;
    /** The chat the row shows in; none in Your artifacts, where every row is the person's own. */
    export let chat: ArtifactChat | undefined = undefined;
    /** Your artifacts come from every bot, so each row says which made it. */
    export let showMaker = false;

    $: kind = artifactKindOf(artifact.kind);
    $: badge = artifactBadge(kind, $LL);
    $: details = [
        showMaker ? $LL.chat.artifacts.by({ maker: artifact.makerName }) : artifactKindName(kind, $LL),
        $LL.chat.artifacts.versionRow({ version: artifact.version }),
        artifact.yours ? undefined : artifact.owner?.name ?? undefined,
        sentLabel(new Date(artifact.updatedAt), $locale),
    ]
        .filter(Boolean)
        .join(" · ");
    $: isOpen = $coWebsites.some(
        (coWebsite) => coWebsite instanceof ArtifactCoWebsite && coWebsite.artifactId === artifact.id
    );

    function open() {
        openArtifactFromCard(
            { id: artifact.id, version: artifact.version, title: artifact.title, kind, maker: artifact.makerName },
            chat
        );
    }
</script>

<button
    type="button"
    class="artifact-row m-0 flex min-h-[44px] w-full items-center gap-3 rounded-xl p-2 text-start"
    class:open={isOpen}
    on:click={open}
    data-testid="chatArtifact"
>
    <span
        class="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[10px] font-bold tracking-wide text-white"
        style="background: {badge.color};"
        aria-hidden="true"
    >
        {badge.label}
    </span>
    <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-sm text-white/90">{artifact.title}</span>
        <span class="truncate text-[11px] text-white/45">{details}</span>
    </span>
</button>

<style>
    .artifact-row {
        font-family: inherit;
        background: transparent;
        border: 1px solid transparent;
    }
    .artifact-row:hover {
        background: rgba(255, 255, 255, 0.06);
    }
    .artifact-row.open {
        background: rgba(134, 41, 252, 0.16);
        border-color: rgba(167, 139, 250, 0.45);
    }
    .artifact-row:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: -2px;
    }
</style>
