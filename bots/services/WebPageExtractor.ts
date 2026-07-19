/**
 * WebPageExtractor — extracts clean markdown from HTML pages.
 *
 * Uses Mozilla Readability (same algorithm as Firefox Reader View)
 * to identify the main article content, then Turndown to convert
 * to clean markdown. Falls back gracefully for non-article pages
 * (dashboards, product pages, search results).
 *
 * All extraction is in-process — no external APIs, no network calls
 * beyond the initial HTML fetch (which FileParser already handles).
 */
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

const MAX_WEBPAGE_CHARS = 10_000;

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    bulletListMarker: '-',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
});

// Configure turndown to preserve tables (Readability keeps them)
turndownService.addRule('preserveTables', {
    filter: 'table',
    replacement: function (content: string, node: any) {
        // Render a simple markdown-like table
        const rows = node.querySelectorAll('tr');
        if (!rows || rows.length === 0) return content;

        const cellText = (c: any) =>
            (c.textContent?.trim() || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

        const headerCells = rows[0]?.querySelectorAll?.('th, td') || [];
        const headerRow = '| ' + Array.from(headerCells).map(cellText).join(' | ') + ' |';
        const separatorRow = '| ' + Array.from(headerCells).map(() => '---').join(' | ') + ' |';

        const dataRows = Array.from(rows).slice(1).map((row: any) => {
            const cells = row.querySelectorAll('td');
            return '| ' + Array.from(cells).map(cellText).join(' | ') + ' |';
        });

        return '\n\n' + [headerRow, separatorRow, ...dataRows].join('\n') + '\n\n';
    },
});

export interface ExtractedWebPage {
    title: string | null;
    content: string;
    excerpt: string | null;
    byline: string | null;
    length: number;
    truncated: boolean;
}

/**
 * Extract clean markdown from HTML content.
 *
 * @param html - Raw HTML string
 * @param sourceUrl - Original URL (used for relative link resolution)
 * @returns Extracted content or fallback
 */
export function extractWebContent(html: string, sourceUrl: string): ExtractedWebPage {
    const { document } = parseHTML(html);
    // Note: linkedom doesn't require a url option for relative link resolution
    // as Readability handles relative URLs via the document.baseURI or
    // the document's URL property. We rely on Readability's built-in
    // relative URL resolution.

    // Try Readability first
    const reader = new Readability(document);
    const article = reader.parse();

    if (article && article.content && article.textContent && article.textContent.trim().length > 50) {
        // Convert HTML content to markdown
        const markdown = turndownService.turndown(article.content);
        const truncated = markdown.length > MAX_WEBPAGE_CHARS;

        return {
            title: article.title || null,
            content: truncated ? markdown.slice(0, MAX_WEBPAGE_CHARS) : markdown,
            excerpt: article.excerpt || null,
            byline: article.byline || null,
            length: markdown.length,
            truncated,
        };
    }

    // Fallback: extract meaningful text from the page body
    return extractFallback(document, sourceUrl);
}

/**
 * Fallback extraction for pages where Readability doesn't find
 * a single dominant article (dashboards, product pages, forums).
 */
function extractFallback(document: Document, sourceUrl: string): ExtractedWebPage {
    const title = document.title?.trim() || null;

    // Remove scripts, styles, nav, footer, header — non-content elements
    const clone = document.body?.cloneNode(true) as HTMLElement | null;
    if (!clone) {
        return {
            title,
            content: '',
            excerpt: null,
            byline: null,
            length: 0,
            truncated: false,
        };
    }

    const removeSelectors = [
        'script', 'style', 'noscript', 'iframe', 'svg',
        'nav', 'footer', 'header', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '.nav', '.navbar', '.footer', '.sidebar', '.menu',
        '.cookie', '.advertisement', '.ad-', '.social-share',
        'form', 'input', 'button',
    ];
    for (const sel of removeSelectors) {
        try {
            const elements = clone.querySelectorAll(sel);
            for (const el of elements) el.remove();
        } catch {
            // Ignore invalid selectors
        }
    }

    // Get text from meaningful elements
    const contentElements = clone.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, code, dl, dt, dd');
    const parts: string[] = [];
    for (const el of contentElements) {
        const text = (el as HTMLElement).textContent?.trim();
        if (text && text.length > 10) {
            parts.push(text);
        }
    }

    let content = parts.join('\n\n');
    const wasTruncated = content.length > MAX_WEBPAGE_CHARS;
    if (wasTruncated) {
        content = content.slice(0, MAX_WEBPAGE_CHARS);
    }

    return {
        title,
        content,
        excerpt: content.length > 150 ? content.slice(0, 150) + '...' : content,
        byline: null,
        length: content.length,
        truncated: wasTruncated,
    };
}

export { MAX_WEBPAGE_CHARS };
