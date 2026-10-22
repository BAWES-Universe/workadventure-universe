<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
</script>

<!-- The same "Opening" box the panel shows while the file downloads, for the moment a reader is working on the bytes. -->
<div class="opening" data-testid="fileViewerReading">
    <div class="box" aria-busy="true">
        <span class="spin" />
        <b>{$LL.chat.fileViewer.opening()}</b>
    </div>
</div>

<style>
    .opening {
        flex: 1;
        height: 100%;
        display: grid;
        place-items: center;
        background: #3a3950;
        padding: 24px;
        text-align: center;
    }

    .box {
        background: #1b1a2b;
        border-radius: 16px;
        padding: 24px 20px;
        max-width: 260px;
        display: grid;
        gap: 10px;
        justify-items: center;
    }

    b {
        font-size: 15px;
    }

    .spin {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.15);
        border-top-color: #b9a6ff;
        animation: file-viewer-reading-spin 0.9s linear infinite;
    }

    @keyframes file-viewer-reading-spin {
        to {
            transform: rotate(360deg);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .spin {
            animation-duration: 3s;
        }
    }
</style>
