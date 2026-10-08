<script lang="ts">
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { LL, locale } from "../../../i18n/i18n-svelte";

    export let classList = "";

    // The room's terms, privacy and cookie links, as the name and camera screens always showed them
    const legals = gameManager.currentStartedRoom?.legals ?? {};

    function link(url: string, label: string): string {
        return '<a href="' + encodeURI(url) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    }

    const legalStrings: string[] = [];
    if (legals?.termsOfUseUrl) legalStrings.push(link(legals.termsOfUseUrl, $LL.login.termsOfUse()));
    if (legals?.privacyPolicyUrl) legalStrings.push(link(legals.privacyPolicyUrl, $LL.login.privacyPolicy()));
    if (legals?.cookiePolicyUrl) legalStrings.push(link(legals.cookiePolicyUrl, $LL.login.cookiePolicy()));

    let legalString: string | undefined;
    if (legalStrings.length > 0) {
        if (Intl.ListFormat) {
            legalString = new Intl.ListFormat($locale, { style: "long", type: "conjunction" }).format(legalStrings);
        } else {
            // For old browsers
            legalString = legalStrings.join(", ");
        }
    }
    /* eslint-disable svelte/no-at-html-tags */
</script>

{#if legalString}
    <p class="u-join-legal terms-and-conditions {classList}">
        {@html $LL.login.terms({ links: legalString })}
    </p>
{/if}
