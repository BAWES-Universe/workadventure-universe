<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import {
        MAX_PROFILE_LINKS,
        openProfileLinkHere,
        profileLinksOpeningHere,
    } from "../../Chat/LinkPreview/ProfileLinks";
    import type { ProfileCardData } from "./ProfileCard";

    /**
     * Someone's card drawn by the game from Orbit's data (#1585), as Orbit's own page draws it: their words, their
     * links and up to three passport stamps, straight on the panel. A link the game can show opens in its window and
     * has no new-tab icon; any other link, and a Ctrl, Cmd, Shift or middle click, opens a new tab.
     */
    export let card: ProfileCardData;

    const dispatch = createEventDispatcher<{ openedHere: void }>();
    const TILTS = [-4, 3, -2, 4, -3, 2];

    let openHere: string[] = [];
    $: checkLinks(card.links.map((link) => link.url));

    function checkLinks(urls: string[]) {
        const asked = urls.filter((url) => url.startsWith("https://")).slice(0, MAX_PROFILE_LINKS);
        openHere = [];
        if (asked.length === 0) return;
        profileLinksOpeningHere(asked)
            .then((here) => {
                // The card may show other links meanwhile.
                openHere = here.filter((url) => card.links.some((link) => link.url === url));
            })
            .catch((error) => console.error("Could not check profile links", error));
    }

    function open(event: MouseEvent, url: string) {
        if (!openHere.includes(url)) return;
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (openProfileLinkHere(url)) dispatch("openedHere");
    }
</script>

<div class="profile-card" data-testid="profileCard">
    {#if card.bio.trim()}
        <p class="bio">{card.bio}</p>
    {/if}
    {#if card.links.length > 0}
        <nav class="links" aria-label={$LL.menu.visitCard.links()}>
            {#each card.links as link (link.url)}
                <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="link-item"
                    on:click={(event) => open(event, link.url)}
                >
                    <span class="link-label">{link.label}</span>
                    {#if !openHere.includes(link.url)}
                        <svg class="link-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            /></svg
                        >
                    {/if}
                </a>
            {/each}
        </nav>
    {/if}
    {#if card.stamps.length > 0}
        <ul class="stamps" aria-label={$LL.menu.visitCard.passport()}>
            {#each card.stamps as stamp, index (index)}
                <li class="stamp" style:--c={stamp.colour} style:--r="{TILTS[index % TILTS.length]}deg">
                    <svg
                        class="stamp-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                        ><path d="M21.54 15H17a2 2 0 0 0-2 2v4.54" /><path
                            d="M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17"
                        /><path d="M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05" /><circle
                            cx="12"
                            cy="12"
                            r="10"
                        /></svg
                    >
                    <strong data-long={stamp.long}>{stamp.world}</strong>
                    <em>{$LL.menu.visitCard.visits({ count: stamp.visits })}</em>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<!-- The same look as Orbit's card page (app/api/profile/[uuid]/route.ts), so nothing changes but the waiting. -->
<style lang="scss">
    .profile-card {
        display: grid;
        gap: 14px;
        padding: 18px 16px;
        font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
        line-height: normal;
        color: #fff;
        -webkit-font-smoothing: antialiased;
        text-align: start;
    }
    .profile-card * {
        margin: 0;
        box-sizing: border-box;
    }
    .bio {
        font-size: 15px;
        line-height: 1.5;
        color: rgb(255 255 255 / 0.82);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        text-align: center;
    }
    .links {
        display: grid;
        gap: 8px;
    }
    .link-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 44px;
        padding: 10px 14px;
        border-radius: 12px;
        background: rgb(255 255 255 / 0.08);
        border: 1px solid rgb(255 255 255 / 0.1);
        color: #fff;
        text-decoration: none;
        font-size: 15px;
        font-weight: 500;
        line-height: normal;
        transition: background 160ms, border-color 160ms;
    }
    .link-item:hover {
        background: rgb(255 255 255 / 0.14);
        border-color: rgb(255 255 255 / 0.18);
    }
    .link-item:focus-visible {
        outline: 2px solid #8b5cf6;
        outline-offset: 2px;
    }
    .link-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .link-icon {
        flex: none;
        width: 16px;
        height: 16px;
        color: rgb(255 255 255 / 0.6);
    }
    .stamps {
        list-style: none;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        padding: 8px 6px 6px;
    }
    .stamp {
        position: relative;
        display: grid;
        justify-items: center;
        align-content: center;
        gap: 2px;
        min-height: 96px;
        min-width: 0;
        padding: 8px 6px;
        text-align: center;
        border-radius: 18px;
        border: 2px dashed color-mix(in srgb, var(--c) 70%, transparent);
        background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--c) 22%, transparent), transparent 70%);
        transform: rotate(var(--r));
    }
    .stamp::after {
        content: "";
        position: absolute;
        inset: 4px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
        pointer-events: none;
    }
    .stamp-icon {
        width: 18px;
        height: 18px;
        color: #2dd4bf;
    }
    .stamp strong {
        max-width: 100%;
        margin-top: 2px;
        font-size: 13px;
        font-weight: 700;
        line-height: normal;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        overflow-wrap: anywhere;
    }
    .stamp strong[data-long="long"] {
        font-size: 10px;
        letter-spacing: 0;
    }
    .stamp strong[data-long="longer"] {
        font-size: 9px;
        letter-spacing: 0;
    }
    .stamp em {
        font-style: normal;
        font-size: 11px;
        font-weight: 700;
        line-height: normal;
        color: color-mix(in srgb, var(--c) 75%, white);
    }
    @media (prefers-reduced-motion: reduce) {
        .link-item {
            transition: none;
        }
    }
</style>
