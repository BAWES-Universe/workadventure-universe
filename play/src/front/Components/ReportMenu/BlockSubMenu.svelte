<script lang="ts">
    import { onMount } from "svelte";
    import { blackListManager } from "../../WebRtc/BlackListManager";
    import { showReportScreenStore, userReportEmpty } from "../../Stores/ShowReportScreenStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconBan } from "@wa-icons";

    export let userUUID: string | undefined;
    export let userName: string;
    let userIsBlocked = false;

    onMount(() => {
        if (userUUID === undefined) {
            userIsBlocked = false;
            console.error("There is no user to block");
        } else {
            userIsBlocked = blackListManager.isBlackListed(userUUID);
        }
    });

    function blockUser(): void {
        if (userUUID === undefined) {
            console.error("There is no user to block");
            return;
        }
        if (blackListManager.isBlackListed(userUUID)) {
            blackListManager.cancelBlackList(userUUID);
        } else {
            blackListManager.blackList(userUUID);
        }
        showReportScreenStore.set(userReportEmpty); //close the report menu
    }
</script>

<section class="flex items-start gap-3 px-5 pb-4 pt-2">
    <span class="report-tile" aria-hidden="true"><IconBan font-size="18" /></span>
    <div class="min-w-0 flex-1">
        <p class="m-0 text-sm font-semibold">{$LL.report.popup.block.title()}</p>
        <p class="m-0 mt-0.5 text-xs leading-5 text-white/65">{$LL.report.popup.block.content({ userName })}</p>
        <button
            type="button"
            data-testid="blockmenu-block-user-button"
            class="m-0 mt-3 flex h-10 max-w-full items-center justify-center rounded-full border-0 bg-white/[0.08] px-4 text-sm font-semibold text-white hover:bg-white/[0.12]"
            on:click|preventDefault={blockUser}
        >
            <span class="truncate">
                {userIsBlocked
                    ? $LL.report.popup.block.unblock({ userName })
                    : $LL.report.popup.block.block({ userName })}
            </span>
        </button>
    </div>
</section>

<style>
    .report-tile {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.75rem;
        color: #fff;
        background: rgba(255, 255, 255, 0.08);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
</style>
