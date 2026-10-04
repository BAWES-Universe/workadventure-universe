<script lang="ts">
    import { slide } from "svelte/transition";
    import { onMount } from "svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconChevronDown, IconExternalLink } from "@wa-icons";

    let gameScene = gameManager.getCurrentGameScene();

    /** The one credit that is open, if any. */
    let openCredit: string | undefined = undefined;

    let mapName = "";
    let mapLink = "";
    let mapDescription = "";
    let mapCopyright: string = $LL.menu.about.copyrights.map.empty();
    let tilesetCopyright: string[] = [];
    let audioCopyright: string[] = [];

    onMount(() => {
        if (gameScene.mapFile.properties !== undefined) {
            const propertyName = gameScene.mapFile.properties.find((property) => property.name === "mapName");
            if (propertyName !== undefined && typeof propertyName.value === "string") {
                mapName = propertyName.value;
            }
            const propertyLink = gameScene.mapFile.properties.find((property) => property.name === "mapLink");
            if (propertyLink !== undefined && typeof propertyLink.value === "string") {
                mapLink = propertyLink.value;
            }
            const propertyDescription = gameScene.mapFile.properties.find(
                (property) => property.name === "mapDescription"
            );
            if (propertyDescription !== undefined && typeof propertyDescription.value === "string") {
                mapDescription = propertyDescription.value;
            }
            const propertyCopyright = gameScene.mapFile.properties.find((property) => property.name === "mapCopyright");
            if (propertyCopyright !== undefined && typeof propertyCopyright.value === "string") {
                mapCopyright = propertyCopyright.value;
            }
        }

        for (const tileset of gameScene.mapFile.tilesets) {
            if ("properties" in tileset && tileset.properties !== undefined) {
                const propertyTilesetCopyright = tileset.properties.find(
                    (property) => property.name === "tilesetCopyright"
                );
                if (propertyTilesetCopyright !== undefined && typeof propertyTilesetCopyright.value === "string") {
                    // Assignment needed to trigger Svelte's reactivity (remove duplicates)
                    tilesetCopyright = Array.from(new Set([...tilesetCopyright, propertyTilesetCopyright.value]));
                }
            }
        }

        for (const layer of gameScene.mapFile.layers) {
            if (layer.type && layer.type === "tilelayer" && layer.properties) {
                const propertyAudioCopyright = layer.properties.find((property) => property.name === "audioCopyright");
                if (propertyAudioCopyright !== undefined && typeof propertyAudioCopyright.value === "string") {
                    // Assignment needed to trigger Svelte's reactivity (remove duplicates)
                    audioCopyright = Array.from(new Set([...audioCopyright, propertyAudioCopyright.value]));
                }
            }
        }
    });

    $: credits = [
        { id: "map", title: $LL.menu.about.copyrights.map.title(), texts: [mapCopyright], empty: "" },
        {
            id: "tileset",
            title: $LL.menu.about.copyrights.tileset.title(),
            texts: tilesetCopyright,
            empty: $LL.menu.about.copyrights.tileset.empty(),
        },
        {
            id: "audio",
            title: $LL.menu.about.copyrights.audio.title(),
            texts: audioCopyright,
            empty: $LL.menu.about.copyrights.audio.empty(),
        },
    ];
</script>

<!-- Map credits: what the map file says about itself, then its three credits as rows that open underneath. -->
<div class="u-set-section" data-testid="settings-map-credits">
    {#if mapName || mapDescription}
        <div class="u-set-row" style="cursor: default">
            <span class="u-set-text">
                {#if mapName}<span class="u-set-label">{mapName}</span>{/if}
                {#if mapDescription}<span class="u-set-hint whitespace-pre-line">{mapDescription}</span>{/if}
            </span>
        </div>
    {/if}
    {#if mapLink}
        <a href={mapLink} class="u-set-row u-set-link no-underline" target="_blank" rel="noopener noreferrer">
            <span class="u-set-text"><span class="u-set-label">{$LL.menu.about.mapLink()}</span></span>
            <IconExternalLink class="u-set-chevron" font-size="16" />
        </a>
    {/if}

    {#each credits as credit (credit.id)}
        <button
            type="button"
            class="u-set-row u-set-choice-head"
            aria-expanded={openCredit === credit.id}
            data-testid="map-credit-{credit.id}"
            on:click={() => (openCredit = openCredit === credit.id ? undefined : credit.id)}
        >
            <span class="u-set-text"><span class="u-set-label">{credit.title}</span></span>
            <IconChevronDown class="u-set-chevron {openCredit === credit.id ? 'is-open' : ''}" font-size="16" />
        </button>
        {#if openCredit === credit.id}
            <div class="u-set-credit" transition:slide={{ duration: 150 }}>
                {#each credit.texts as text (text)}
                    <p class="whitespace-pre-line">{text}</p>
                {:else}
                    <p>{credit.empty}</p>
                {/each}
            </div>
        {/if}
    {/each}
</div>
