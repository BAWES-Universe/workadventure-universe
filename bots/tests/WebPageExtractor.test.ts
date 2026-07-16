/**
 * Tests for WebPageExtractor — extracts clean markdown from HTML pages
 * using Mozilla Readability + Turndown.
 */
import { describe, it, expect } from 'vitest';
import { extractWebContent } from '../services/WebPageExtractor';

describe('WebPageExtractor', () => {
    describe('extractWebContent', () => {
        it('extracts article content from a blog-style HTML page', () => {
            const html = `<!DOCTYPE html>
<html>
<head><title>How AI Agents Work</title></head>
<body>
<nav>Navigation links here</nav>
<article>
<h1>How AI Agents Work</h1>
<p>AI agents are autonomous systems that perceive their environment and take actions to achieve goals.</p>
<p>They combine large language models with tool-use capabilities to solve complex tasks.</p>
<p>This technology is rapidly transforming how we interact with software.</p>
</article>
<footer>Copyright 2026</footer>
</body>
</html>`;

            const result = extractWebContent(html, 'https://example.com/blog/ai-agents');

            expect(result.title).toBe('How AI Agents Work');
            // Readability extracts h1 as title and doesn't duplicate it in content
            expect(result.content).toContain('AI agents are autonomous systems');
            expect(result.content).toContain('large language models');
            expect(result.content).not.toContain('Navigation links here');
            expect(result.content).not.toContain('Copyright 2026');
            expect(result.truncated).toBe(false);
        });

        it('extracts article with byline and excerpt', () => {
            const html = `<!DOCTYPE html>
<html>
<head>
<title>The Future of Web Scraping</title>
<meta name="author" content="Jane Smith">
<meta name="description" content="How modern AI agents extract and process web content.">
</head>
<body>
<article>
<h1>The Future of Web Scraping</h1>
<p class="byline">By Jane Smith</p>
<p>Modern AI agents need clean, structured data from the web to function effectively.</p>
<p>Traditional scraping approaches are giving way to intelligent extraction methods.</p>
<p>Readability algorithms and markdown conversion are at the heart of this transformation.</p>
</article>
</body>
</html>`;

            const result = extractWebContent(html, 'https://example.com/blog/web-scraping');

            expect(result.title).toBe('The Future of Web Scraping');
            expect(result.content).toContain('Jane Smith');
            expect(result.content).toContain('Modern AI agents');
            expect(result.content).toContain('Traditional scraping');
        });

        it('strips scripts and styles from extracted content', () => {
            const html = `<!DOCTYPE html>
<html>
<head><title>Clean Content Test</title>
<script>alert('xss');</script>
<style>.hidden{display:none}</style>
</head>
<body>
<article>
<h1>Clean Content</h1>
<p>This is the real content.</p>
<script>console.log('injected');</script>
<p>More real content.</p>
<style>.irrelevant{color:red}</style>
</article>
</body>
</html>`;

            const result = extractWebContent(html, 'https://example.com/clean');

            expect(result.content).toContain('Clean Content');
            expect(result.content).toContain('real content');
            expect(result.content).not.toContain('xss');
            expect(result.content).not.toContain('console.log');
            expect(result.content).not.toContain('hidden');
        });

        it('falls back gracefully for non-article pages (dashboards, product pages)', () => {
            const html = `<!DOCTYPE html>
<html>
<head><title>Product Dashboard</title></head>
<body>
<header><h1>Acme Corp Dashboard</h1></header>
<main>
<div class="metric"><h2>Revenue</h2><p>$1.2M</p></div>
<div class="metric"><h2>Users</h2><p>45,000</p></div>
<div class="metric"><h2>Growth</h2><p>23%</p></div>
<section><h3>Recent Activity</h3>
<ul><li>User joined premium plan</li><li>New enterprise deal closed</li><li>Feature X deployed to production</li></ul>
</section>
</main>
<footer>Confidential</footer>
</body>
</html>`;

            const result = extractWebContent(html, 'https://example.com/dashboard');

            expect(result.title).toBe('Product Dashboard');
            expect(result.content.length).toBeGreaterThan(10);
            // Fallback should still extract meaningful text
            expect(result.content).toContain('Revenue');
            expect(result.content).toContain('$1.2M');
        });

        it('returns empty content for pages with no body', () => {
            const html = '<!DOCTYPE html><html><head><title>Empty</title></head></html>';
            const result = extractWebContent(html, 'https://example.com/empty');

            expect(result.content).toBe('');
            expect(result.title).toBe('Empty');
        });

        it('handles long-form article with code blocks', () => {
            const html = `<!DOCTYPE html>
<html>
<head><title>Building with TypeScript</title></head>
<body>
<article>
<h1>Building with TypeScript</h1>
<p>TypeScript adds static typing to JavaScript, catching errors at compile time.</p>
<pre><code>function greet(name: string): string {
  return \`Hello, \${name}!\`;
}</code></pre>
<p>This makes large codebases more maintainable.</p>
<h2>Getting Started</h2>
<p>Install TypeScript via npm and start adding types to your project.</p>
</article>
</body>
</html>`;

            const result = extractWebContent(html, 'https://example.com/typescript');

            expect(result.title).toBe('Building with TypeScript');
            expect(result.content).toContain('TypeScript adds static typing');
            expect(result.content).toContain('greet');
            expect(result.content).toContain('Getting Started');
        });

        it('extracts content from pages with complex navigation patterns', () => {
            const html = `<!DOCTYPE html>
<html>
<head><title>Deep Dive into Agents</title></head>
<body>
<nav role="navigation">
<ul><li><a href="/">Home</a></li><li><a href="/blog">Blog</a></li><li><a href="/about">About</a></li></ul>
</nav>
<aside><div class="sidebar">Related articles sidebar content</div></aside>
<main>
<article>
<h1>Deep Dive into AI Agents</h1>
<p>This article explores the architecture of modern AI agents and how they leverage tools.</p>
<p>Key components include perception, reasoning, action, and memory systems.</p>
</article>
</main>
<footer>© 2026 Example Corp</footer>
</body>
</html>`;

            const result = extractWebContent(html, 'https://example.com/deep-dive');

            expect(result.title).toBe('Deep Dive into Agents');
            // h1 extracted as article title, content starts from the first paragraph
            expect(result.content).toContain('This article explores the architecture of modern AI agents');
            expect(result.content).toContain('perception, reasoning, action');
            expect(result.content).not.toContain('sidebar content');
            expect(result.content).not.toContain('Home');
            expect(result.content).not.toContain('© 2026');
        });

        it('handles HTML with tables', () => {
            const html = `<!DOCTYPE html>
<html>
<head><title>Pricing Plans</title></head>
<body>
<article>
<h1>Pricing</h1>
<table>
<tr><th>Plan</th><th>Price</th><th>Users</th></tr>
<tr><td>Starter</td><td>$10/mo</td><td>5</td></tr>
<tr><td>Pro</td><td>$50/mo</td><td>50</td></tr>
<tr><td>Enterprise</td><td>$200/mo</td><td>Unlimited</td></tr>
</table>
<p>All plans include a 14-day free trial.</p>
</article>
</body>
</html>`;

            const result = extractWebContent(html, 'https://example.com/pricing');

            expect(result.title).toBe('Pricing Plans');
            expect(result.content).toContain('Starter');
            expect(result.content).toContain('$10/mo');
            expect(result.content).toContain('14-day free trial');
            // Table should be preserved in some form
            expect(result.content).toContain('Pro');
            expect(result.content).toContain('Enterprise');
        });
    });
});
