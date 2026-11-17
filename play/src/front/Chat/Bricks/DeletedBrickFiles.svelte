<script lang="ts">
    import { onMount } from "svelte";
    import { get } from "svelte/store";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { deletedBrickFilesList, fileSize, type BrickResult } from "./BrickFiles";
    import { shortDay } from "./Brick";
    import { IconFile } from "@wa-icons";
    import "./BrickGroups.css";

    /**
     * What a person's Bricks' computers made, whose Brick was deleted (the Bricks page). The files are theirs and stay for the days in Limits or until they
     * delete them; only the Brick's name on them is "A deleted Brick". Shows nothing when there are none. Opened and deleted with the person's own sign-in.
     */
    const list = deletedBrickFilesList();
    const { results } = list;

    onMount(() => {
        list.load().catch((error) => console.error(error));
    });

    function note(result: BrickResult): string {
        const where =
            result.delivery === "delivered"
                ? $LL.chat.brick.files.resultSent()
                : result.delivery === "waiting"
                ? $LL.chat.brick.files.resultWaiting()
                : $LL.chat.brick.files.resultNotDelivered();
        return [result.brick ?? "", shortDay(result.at, $locale), fileSize(result.sizeBytes, get(locale)), where]
            .filter(Boolean)
            .join(" · ");
    }

    function download(result: BrickResult) {
        list.downloadResult(result)
            .then((done) => {
                if (!done) warningMessageStore.addWarningMessage($LL.chat.brick.files.resultFailed());
            })
            .catch((error) => console.error(error));
    }

    function remove(result: BrickResult) {
        list.deleteResult(result.id)
            .then((gone) => {
                if (!gone) warningMessageStore.addWarningMessage($LL.chat.brick.files.deleteFailed());
            })
            .catch((error) => console.error(error));
    }
</script>

{#if $results.length > 0}
    <div class="bkg" data-testid="deletedBrickFiles">
        <div class="bkg-cap gap">{$LL.chat.brick.files.deletedBrickFiles()}</div>
        {#each $results as result (result.id)}
            <div class="bkg-tap" data-testid="deletedBrickFileRow" data-delivery={result.delivery}>
                <span class="bkg-ico"><IconFile font-size="20" /></span>
                <span class="bkg-mtx">
                    <span class="bkg-t">{result.name}</span>
                    <span class="bkg-cn">{note(result)}</span>
                    <span class="bkg-acts">
                        <PageButton testId="deletedBrickFileDownload" on:click={() => download(result)}
                            >{$LL.chat.brick.files.download()}</PageButton
                        >
                        <PageButton testId="deletedBrickFileDelete" on:click={() => remove(result)}
                            >{$LL.chat.brick.files.delete()}</PageButton
                        >
                    </span>
                </span>
            </div>
        {/each}
        <p class="bkg-note"><span>{$LL.chat.brick.files.deletedBrickFilesNote()}</span></p>
    </div>
{/if}
