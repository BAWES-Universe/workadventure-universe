/**
 * Put a file someone sent the bot on the uploader, the same place bubble uploads go, so FileParser can read it.
 * Returns null when no uploader is configured.
 */
export async function uploadAttachment(data: Buffer, mimeType: string, filename: string): Promise<string | null> {
    const uploaderUrl = process.env.UPLOADER_URL;
    const botServiceToken = process.env.BOT_SERVICE_TOKEN;
    if (!uploaderUrl || !botServiceToken) return null;

    const formData = new FormData();
    formData.append('file', new Blob([data], { type: mimeType }), filename.replace(/[^\w.\-]+/g, '_') || 'file');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(`${uploaderUrl}/upload-file`, {
            method: 'POST',
            headers: { 'x-bot-service-token': botServiceToken },
            body: formData,
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
        }
        const result = await response.json();
        const uploaded = Array.isArray(result) ? result[0] : result;
        return uploaded?.location || uploaded?.url || null;
    } finally {
        clearTimeout(timeout);
    }
}
