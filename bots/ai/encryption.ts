/**
 * Encryption utilities for decrypting AI provider credentials
 * 
 * Credentials are encrypted by Admin API using AES-256-GCM
 * Format: iv:authTag:encryptedData (all hex-encoded)
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Get encryption key from environment
 */
function getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error('ENCRYPTION_KEY environment variable is not set');
    }

    // Key is 64 hex characters (32 bytes)
    if (key.length === 64) {
        return Buffer.from(key, 'hex');
    }

    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
}

/**
 * Decrypt API key from encrypted format
 * 
 * @param encrypted - Encrypted string in format "iv:authTag:encryptedData" (all hex)
 * @returns Decrypted API key
 * @throws Error if decryption fails or format is invalid
 */
export function decryptApiKey(encrypted: string | null | undefined): string | null {
    if (!encrypted) {
        return null; // Provider doesn't need an API key (e.g., LMStudio)
    }

    const parts = encrypted.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format. Expected "iv:authTag:encryptedData"');
    }

    const [ivHex, authTagHex, encryptedData] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

