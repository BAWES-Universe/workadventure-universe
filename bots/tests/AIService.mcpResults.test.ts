import { describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

const ai = new AIService(null!, null!, '');
const format = (result: unknown) => ai['formatToolResults']([{ id: 't1', name: 'fetch_doc', result }]);

describe('what the model reads of a tool server\'s answer (#1566)', () => {
    it('gets the text of an embedded text resource, with where it lives', () => {
        const out = format([{ type: 'resource', resource: { uri: 'file:///notes.md', mimeType: 'text/markdown', text: '# Notes\nBuy milk' } }]);
        expect(out).toContain('file:///notes.md');
        expect(out).toContain('# Notes\nBuy milk');
    });

    it('gets a resource link beside the text, not only the text', () => {
        const out = format([
            { type: 'text', text: 'Found 1 report.' },
            { type: 'resource_link', uri: 'https://example.com/report.pdf', name: 'Q3 report', description: 'Sales by region' },
        ]);
        expect(out).toContain('Found 1 report.');
        expect(out).toContain('Q3 report: Sales by region (https://example.com/report.pdf)');
    });

    it('gets a resource link with no name or description as its address', () => {
        expect(format([{ type: 'resource_link', uri: 'https://example.com/a' }])).toBe('fetch_doc: https://example.com/a');
    });

    it('still gets only the address of a resource that holds no text', () => {
        expect(format([{ type: 'resource', resource: { uri: 'https://example.com/a.bin', blob: 'AAAA' } }])).toBe(
            'fetch_doc: https://example.com/a.bin'
        );
    });

    it('still gets plain text items as they were', () => {
        expect(format([{ type: 'text', text: 'hello' }])).toBe('fetch_doc: hello');
    });
});
