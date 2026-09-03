import axios from 'axios';

export interface BotPushNotificationPayload {
    target: string;
    title: string;
    body: string;
    url?: string;
}

export interface BotPushNotificationResult {
    dryRun: boolean;
    matched: number;
    sent: number;
    forwarded: boolean;
    skippedReason?: string;
}

const DEFAULT_PUSH_API_URL = 'http://localhost:8080';

export class PushNotificationClient {
    constructor(
        private readonly baseUrl: string = process.env.PUSH_API_URL ||
            process.env.WORKADVENTURE_URL ||
            process.env.PUSHER_URL ||
            DEFAULT_PUSH_API_URL,
        private readonly serviceToken: string = process.env.PUSH_SERVICE_TOKEN || ''
    ) {}

    isConfigured(): boolean {
        return this.baseUrl.trim().length > 0 && this.serviceToken.trim().length > 0;
    }

    async send(payload: BotPushNotificationPayload): Promise<BotPushNotificationResult> {
        if (!this.isConfigured()) {
            return {
                dryRun: true,
                matched: 0,
                sent: 0,
                forwarded: false,
                skippedReason: 'push-service-not-configured',
            };
        }

        try {
            const response = await axios.post(this.getSendUrl(), payload, {
                headers: {
                    Authorization: `Bearer ${this.serviceToken}`,
                },
                timeout: 5000,
            });

            return {
                dryRun: Boolean(response.data?.dryRun),
                matched: Number(response.data?.matched || 0),
                sent: Number(response.data?.sent || 0),
                forwarded: true,
                ...(response.data?.skippedReason ? { skippedReason: String(response.data.skippedReason) } : {}),
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const responseData = error.response?.data;
                let reason: string | undefined;

                if (typeof responseData === 'string') {
                    reason = responseData;
                } else if (responseData && typeof responseData === 'object') {
                    const errorPayload = responseData as { error?: unknown; message?: unknown };
                    reason =
                        errorPayload.error !== undefined
                            ? String(errorPayload.error)
                            : errorPayload.message !== undefined
                            ? String(errorPayload.message)
                            : JSON.stringify(responseData);
                }

                reason ||= error.response?.statusText || error.message;
                throw new Error(`Push notification API request failed${status ? ` (${status})` : ''}: ${reason}`);
            }

            throw error;
        }
    }

    private getSendUrl(): string {
        return `${this.normalizeHttpBaseUrl(this.baseUrl)}/api/push/send`;
    }

    private normalizeHttpBaseUrl(value: string): string {
        return value
            .trim()
            .replace(/^ws:\/\//, 'http://')
            .replace(/^wss:\/\//, 'https://')
            .replace(/\/+$/, '');
    }
}
