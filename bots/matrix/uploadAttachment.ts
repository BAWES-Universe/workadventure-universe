/**
 * Put a file someone sent the bot on the uploader, the same place bubble uploads go, so FileParser can read it.
 * Returns null when no uploader is configured.
 */
export async function uploadAttachment(data: Buffer, mimeType: string, filename: string): Promise<string | null> {
    return (await uploadAttachmentWithLink(data, mimeType, filename))?.location ?? null;
}

/**
 * The same, with the uploader's own lasting link when the file's link is a signed one that runs out. That link is written with the address
 * the uploader is reached at from outside, which the bot server may not use itself (a name inside its network).
 */
export async function uploadAttachmentWithLink(data: Buffer, mimeType: string, filename: string): Promise<{ location: string; lasting?: string } | null> {
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
        const location = uploaded?.location || uploaded?.url;
        if (!location) return null;
        return { location, ...(typeof uploaded?.lastingLocation === 'string' && uploaded.lastingLocation ? { lasting: uploaded.lastingLocation } : {}) };
    } finally {
        clearTimeout(timeout);
    }
}
