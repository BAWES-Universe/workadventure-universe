/**
 * Tests for the read_web_page tool: bare addresses work, bad ones are refused,
 * and fetching goes through FileParser (which carries the SSRF guards).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/FileParser', () => ({
    FileParser: {
        sniffContentType: vi.fn(),
        parseFile: vi.fn(),
    },
}));

import { FileParser } from '../services/FileParser';
import { readWebPageForTool } from '../ai/AIService';

describe('readWebPageForTool', () => {
    beforeEach(() => {
        vi.mocked(FileParser.sniffContentType).mockReset();
        vi.mocked(FileParser.parseFile).mockReset();
    });

    it('reads a bare address as https', async () => {
        vi.mocked(FileParser.sniffContentType).mockResolvedValue('text/html');
        vi.mocked(FileParser.parseFile).mockResolvedValue({
            type: 'webpage',
            url: 'https://bawes.net/',
            mimeType: 'text/html',
            text: '# BAWES\nWe build Universe.',
            summary: 'Web page: BAWES',
            metadata: { title: 'BAWES' },
        });

        const result = await readWebPageForTool('bawes.net');

        expect(FileParser.parseFile).toHaveBeenCalledWith('https://bawes.net/', 'text/html');
        expect(result).toEqual({
            url: 'https://bawes.net/',
            title: 'BAWES',
            content: '# BAWES\nWe build Universe.',
            truncated: false,
        });
    });

    it('treats an unknown content type as a web page', async () => {
        vi.mocked(FileParser.sniffContentType).mockResolvedValue(null);
        vi.mocked(FileParser.parseFile).mockResolvedValue({
            type: 'webpage',
            mimeType: 'text/html',
            summary: 'Failed to fetch web page',
        });

        const result = await readWebPageForTool('https://example.com');

        expect(FileParser.parseFile).toHaveBeenCalledWith('https://example.com/', 'text/html');
        expect(result).toEqual({ url: 'https://example.com/', summary: 'Failed to fetch web page' });
    });

    it('refuses what is not a web address without fetching', async () => {
        expect(await readWebPageForTool('')).toHaveProperty('error');
        expect(await readWebPageForTool(undefined)).toHaveProperty('error');
        expect(await readWebPageForTool('file:///etc/passwd')).toHaveProperty('error');
        expect(FileParser.parseFile).not.toHaveBeenCalled();
    });
});
