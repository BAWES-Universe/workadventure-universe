import { SimpleCoWebsite } from "./SimpleCoWebsite";

/**
 * StudentHub's embed as an item of the window (E3). No scripting API (`allowApi: false`): the page never joins the
 * generic iframe bus. Its address is hidden, so the row offers no "Copy link" or "Open in browser tab" (a copied embed
 * URL only says "Open this in Universe" anyway). The iframe it is shown in is reported to `onIframe`, so the dedicated
 * identity listener answers that window and no other.
 */
export class StudentHubCoWebsite extends SimpleCoWebsite {
    constructor(
        url: URL,
        private readonly onIframe: {
            mounted(iframe: HTMLIFrameElement): void;
            unmounted(iframe: HTMLIFrameElement): void;
        }
    ) {
        super(url, false, undefined, undefined, true, true);
    }

    override getAllowApi(): boolean {
        return false;
    }

    override iframeMounted(iframe: HTMLIFrameElement): void {
        this.onIframe.mounted(iframe);
    }

    override iframeUnmounted(iframe: HTMLIFrameElement): void {
        this.onIframe.unmounted(iframe);
    }
}
