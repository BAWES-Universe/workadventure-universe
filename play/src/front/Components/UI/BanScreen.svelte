<script lang="ts">
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import type { BanDetails } from "../../Connection/BanApi";
    import { banDaysLeft, fetchBanDetails, sendBanAppeal } from "../../Connection/BanApi";
    import { worldSlugFromRoomUrl } from "../../Stores/WorldNameStore";
    import { inputFormFocusStore } from "../../Stores/UserInputStore";
    import { LL, locale } from "../../../i18n/i18n-svelte";
    import { IconBan, IconCheck } from "@wa-icons";

    // The room the player was refused (or was in when an admin banned them).
    const roomUrl = (() => {
        const url = new URL(connectionManager.currentRoom?.key ?? window.location.href);
        url.search = "";
        url.hash = "";
        return url.toString();
    })();

    // Until the admin answers (or if it can't), the screen says only what is sure: the player can't come in.
    let status: "loading" | "ready" | "failed" = "loading";
    let details: BanDetails | undefined;

    fetchBanDetails(roomUrl)
        .then((answer) => {
            details = answer;
            status = "ready";
        })
        .catch((e) => {
            console.error("Ban screen: could not load the ban details", e);
            status = "failed";
        });
    onDestroy(() => inputFormFocusStore.set(false));

    // The world's name from the admin, else its slug in the room URL; none until the admin answers.
    $: worldName = status === "ready" ? details?.worldName || worldSlugFromRoomUrl(roomUrl) : "";
    $: worldLabel = worldName || $LL.report.popup.thisWorld();
    $: expiresAt = details?.expiresAt ? new Date(details.expiresAt) : undefined;
    // The ban is over: an admin lifted it (on appeal or not), or it ended.
    $: lifted = status === "ready" && (!details?.banned || details.appeal?.decision === "lifted");
    $: kept = status === "ready" && !lifted && details?.appeal?.decision === "kept";

    let appealText = "";
    let sending = false;
    let appealSent = false;
    let appealError = false;
    $: appealDone = appealSent || details?.appeal?.decision === "pending";

    function submitAppeal() {
        const text = appealText.trim();
        if (text === "" || sending) return;
        sending = true;
        appealError = false;
        sendBanAppeal(roomUrl, text)
            .then((result) => {
                // Not banned any more: the ban ended or was lifted meanwhile.
                if (result === "not_banned" && details) details = { ...details, banned: false };
                // Already sent (from another tab, say) shows the same confirmation.
                else appealSent = true;
            })
            .catch((e) => {
                console.error("Ban screen: could not send the appeal", e);
                appealError = true;
            })
            .finally(() => (sending = false));
    }

    function formatDate(date: Date, currentLocale: string): string {
        const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
        if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
        try {
            return date.toLocaleDateString(currentLocale, options);
        } catch {
            return date.toLocaleDateString(undefined, options);
        }
    }

    // The sentence with the end date, cut around the date so the date can be shown in bold.
    const DATE_MARK = "⁣DATE⁣";
    $: untilParts = expiresAt
        ? $LL.report.ban
              .until({ worldName: worldLabel, date: DATE_MARK, days: banDaysLeft(expiresAt) })
              .split(DATE_MARK)
        : [];

    function goElsewhere() {
        // The start page sends a player back to the last room they opened, which is this one: forget it first.
        const root = new URL("/", window.location.href).toString();
        localUserStore
            .setLastRoomUrl(root)
            .catch((e) => console.error(e))
            .finally(() => window.location.assign(root));
    }

    function enterWorld() {
        window.location.reload();
    }
</script>

<main
    class="ban-screen pointer-events-auto fixed inset-0 z-[700] flex flex-col items-center overflow-auto px-3 py-8 text-white"
    data-testid="banScreen"
    transition:fly={{ y: -200, duration: 500 }}
>
    <div class="m-auto flex w-[min(420px,100%)] flex-col items-center">
        <p class="ban-wordmark m-0 mb-6">Universe</p>
        <div class="u-surface flex w-full flex-col gap-4 rounded-2xl p-5">
            {#if lifted}
                <div class="flex items-start gap-3">
                    <span class="ban-tile ban-tile-green" aria-hidden="true"><IconCheck font-size="18" /></span>
                    <div class="min-w-0 flex-1">
                        <h2 class="m-0 text-lg font-bold normal-case tracking-normal">
                            {$LL.report.ban.lifted.title()}
                        </h2>
                        <p class="m-0 mt-1 text-sm leading-5 text-white/65">
                            {$LL.report.ban.lifted.content({ worldName: worldLabel })}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    class="u-cta m-0 flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-bold"
                    data-testid="banEnterButton"
                    on:click={enterWorld}>{$LL.report.ban.lifted.enter({ worldName: worldLabel })}</button
                >
            {:else}
                <div class="flex items-start gap-3">
                    <span class="ban-tile" aria-hidden="true"><IconBan font-size="18" /></span>
                    <div class="min-w-0 flex-1">
                        <h2 class="m-0 text-lg font-bold normal-case tracking-normal" data-testid="banTitle">
                            {worldName ? $LL.report.ban.title({ worldName }) : $LL.report.ban.titleGeneric()}
                        </h2>
                        <p class="m-0 mt-1 text-sm leading-5 text-white/65">
                            {#if status === "ready" && untilParts.length === 2}
                                {untilParts[0]}<b class="text-white"
                                    >{expiresAt ? formatDate(expiresAt, $locale) : ""}</b
                                >{untilParts[1]}
                            {:else if status === "ready"}
                                {$LL.report.ban.forever({ worldName: worldLabel })}
                            {/if}
                            {$LL.report.ban.elsewhere()}
                        </p>
                    </div>
                </div>

                {#if status === "ready" && details?.reason}
                    <div class="ban-reason rounded-[12px] bg-black/25 px-3 py-2 text-sm text-white/80">
                        <span
                            class="block text-[11px] font-bold uppercase tracking-[0.14em] text-[rgba(196,181,253,0.85)]"
                            >{$LL.report.ban.reason()}</span
                        >
                        “{details.reason}”
                    </div>
                {/if}

                {#if status === "ready"}
                    {#if kept}
                        <p class="m-0 rounded-[12px] bg-white/[0.06] px-3 py-2.5 text-sm text-white/80">
                            {$LL.report.ban.kept()}
                        </p>
                    {:else if appealDone}
                        <p
                            class="m-0 flex items-center gap-2.5 rounded-[12px] bg-emerald-500/10 px-3 py-2.5 text-sm text-white"
                            data-testid="banAppealSent"
                        >
                            <span
                                class="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"
                                aria-hidden="true"><IconCheck font-size="16" /></span
                            >
                            {$LL.report.ban.appeal.sent({ worldName: worldLabel })}
                        </p>
                    {:else}
                        <form class="flex flex-col gap-2" on:submit|preventDefault={submitAppeal}>
                            <p class="m-0 text-sm font-semibold">{$LL.report.ban.appeal.title()}</p>
                            <p class="m-0 text-xs leading-5 text-white/65">{$LL.report.ban.appeal.content()}</p>
                            <textarea
                                bind:value={appealText}
                                rows="3"
                                maxlength="1000"
                                placeholder={$LL.report.ban.appeal.placeholder()}
                                aria-label={$LL.report.ban.appeal.placeholder()}
                                data-testid="banAppealText"
                                class="ban-field m-0 block w-full resize-none rounded-[12px] border-0 px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none"
                                on:focus={() => inputFormFocusStore.set(true)}
                                on:blur={() => inputFormFocusStore.set(false)}
                            />
                            {#if appealError}
                                <p class="m-0 text-xs text-pop-red">{$LL.report.ban.appeal.error()}</p>
                            {/if}
                            <button
                                type="submit"
                                class="m-0 flex h-10 items-center justify-center self-start rounded-full border-0 bg-white/[0.08] px-4 text-sm font-semibold text-white hover:bg-white/[0.12] disabled:pointer-events-none disabled:opacity-40"
                                data-testid="banAppealSend"
                                disabled={appealText.trim() === "" || sending}>{$LL.report.ban.appeal.send()}</button
                            >
                        </form>
                    {/if}
                {/if}
            {/if}

            <button
                type="button"
                class="m-0 flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-bold {lifted
                    ? 'u-cta-secondary'
                    : 'u-cta'}"
                data-testid="banGoElsewhere"
                on:click={goElsewhere}>{$LL.report.ban.goElsewhere()}</button
            >
        </div>
    </div>
</main>

<style>
    .ban-screen {
        background: radial-gradient(120% 80% at 50% 0%, rgb(31 28 47), rgb(10 8 20));
    }
    .ban-wordmark {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.01em;
        background: linear-gradient(135deg, #c4b5fd 0%, #e9c74c 50%, #c4b5fd 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
    }
    .ban-tile {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.75rem;
        background: rgba(233, 109, 81, 0.18);
        color: #f7a48f;
    }
    .ban-tile-green {
        background: rgba(16, 185, 129, 0.2);
        color: #6ee7b7;
    }
    .ban-reason {
        box-shadow: inset 0 0 0 1px var(--u-surface-edge);
    }
    .ban-field {
        font-family: inherit;
        background: rgba(0, 0, 0, 0.28);
        box-shadow: inset 0 0 0 1px var(--u-surface-edge);
    }
    .ban-field:focus {
        box-shadow: inset 0 0 0 1px rgba(196, 181, 253, 0.7);
    }
</style>
