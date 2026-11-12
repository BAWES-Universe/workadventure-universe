/**
 * Files people deleted from a Brick's list (game #2003). Orbit has already taken them off the list; the uploader holds the
 * bytes and only the bot server may delete from it, so Orbit queues each one (where it is, nothing else) and this takes
 * them off the uploader. Orbit forgets a removal only when told it was done, so a restart in between loses none. A file
 * the uploader no longer has counts as done. Nothing about a file is ever logged.
 */
import axios from 'axios';

export interface FileRemoval {
    id: string;
    bucket: string;
    fileId: string;
}

export interface FileRemovalSweeperConfig {
    adminApiUrl: string | undefined;
    uploaderUrl: string | undefined;
    botServiceToken: string | undefined;
    /** How often to look, in milliseconds. */
    everyMs?: number;
}

export class FileRemovalSweeper {
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = false;

    constructor(private readonly config: FileRemovalSweeperConfig) {}

    /** Whether there is everything to do it with. Without an Orbit, an uploader or a token nothing is queued or removed. */
    isConfigured(): boolean {
        return !!this.config.adminApiUrl && !!this.config.uploaderUrl && !!this.config.botServiceToken;
    }

    start(): void {
        if (this.timer || !this.isConfigured()) return;
        this.timer = setInterval(() => void this.sweep(), this.config.everyMs ?? 60_000);
        this.timer.unref?.();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /** One round. Returns how many files were taken off the uploader and confirmed. Never throws. */
    async sweep(): Promise<number> {
        if (!this.isConfigured() || this.running) return 0;
        this.running = true;
        try {
            const headers = { Authorization: `Bearer ${this.config.botServiceToken}` };
            const listed = await axios.get(`${this.config.adminApiUrl}/api/bot-files/removals`, { headers, timeout: 10_000 });
            const removals: FileRemoval[] = Array.isArray(listed.data?.removals)
                ? listed.data.removals.filter((one: FileRemoval) => typeof one?.id === 'string' && typeof one?.fileId === 'string')
                : [];
            const done: string[] = [];
            for (const removal of removals) {
                if (await this.removeFromUploader(removal.fileId)) done.push(removal.id);
            }
            if (done.length > 0) {
                await axios.post(`${this.config.adminApiUrl}/api/bot-files/removals`, { ids: done }, { headers, timeout: 10_000 });
            }
            return done.length;
        } catch (error) {
            // An Orbit without the route yet answers 404 or 405: nothing is queued there, nothing to say
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            if (status !== 404 && status !== 405) {
                console.warn(`[FileRemovals] Could not remove deleted files: ${axios.isAxiosError(error) ? (status ?? error.code ?? 'no answer') : 'failed'}`);
            }
            return 0;
        } finally {
            this.running = false;
        }
    }

    /** True when the file is gone from the uploader (removed now, or not there). */
    private async removeFromUploader(fileId: string): Promise<boolean> {
        try {
            await axios.delete(`${this.config.uploaderUrl}/upload-file/${encodeURIComponent(fileId)}`, {
                headers: { 'x-bot-service-token': this.config.botServiceToken! },
                timeout: 10_000,
            });
            return true;
        } catch (error) {
            return axios.isAxiosError(error) && error.response?.status === 404;
        }
    }
}
