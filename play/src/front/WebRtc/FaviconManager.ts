/**
 * Adds a red dot to the tab favicon while the user is in a proximity bubble, and puts the original back afterwards.
 *
 * The original href of each icon link is remembered and restored as-is: the links are never removed, so a favicon
 * that cannot be redrawn (e.g. served from another origin without CORS headers, as the admin-provided icons are)
 * stays in place instead of disappearing from the tab.
 */
export class FaviconManager {
    private readonly originalHrefs = new Map<HTMLLinkElement, string>();
    private notificationActive = false;

    public pushNotificationFavicon(): void {
        this.notificationActive = true;
        const links = document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']");
        for (const link of links) {
            let originalHref = this.originalHrefs.get(link);
            if (originalHref === undefined) {
                originalHref = link.href;
                this.originalHrefs.set(link, originalHref);
            }

            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                // The bubble may have ended while the image was loading.
                if (!this.notificationActive) {
                    return;
                }
                try {
                    link.href = this.drawNotificationFavicon(img);
                } catch (e) {
                    // A cross-origin icon without CORS headers taints the canvas: keep the original icon.
                    console.warn("Could not draw the notification favicon", e);
                }
            };
            img.onerror = () => {
                console.warn(`Could not load the favicon ${originalHref} to draw the notification favicon`);
            };
            img.src = originalHref;
        }
    }

    public pushOriginalFavicon(): void {
        this.notificationActive = false;
        for (const [link, href] of this.originalHrefs) {
            link.href = href;
        }
        this.originalHrefs.clear();
    }

    private drawNotificationFavicon(img: HTMLImageElement): string {
        const faviconSize = 16;
        const canvas = document.createElement("canvas");
        canvas.width = faviconSize;
        canvas.height = faviconSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("No 2d canvas context");
        }

        // Draw Original Favicon as Background
        ctx.drawImage(img, 0, 0, faviconSize, faviconSize);

        // Draw Notification Circle in bottom right corner of favicon (16x16) with radius 5 and color red
        const x = canvas.width - faviconSize / 3;
        const y = canvas.height - faviconSize / 3;
        ctx.beginPath();
        ctx.arc(x, y, faviconSize / 3, 0, 2 * Math.PI);
        ctx.fillStyle = "#FF0000";
        ctx.fill();

        // Draw Notification Circle in bottom right corner of favicon (16x16) with radius 3 and color white
        ctx.beginPath();
        ctx.arc(x, y, faviconSize / 9, 0, 2 * Math.PI);
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();

        return canvas.toDataURL();
    }
}

export const faviconManager = new FaviconManager();
