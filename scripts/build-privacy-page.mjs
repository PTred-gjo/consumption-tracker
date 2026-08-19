/**
 * Renders PRIVACY.md into a standalone styled HTML page.
 *
 * Google Play requires a publicly reachable privacy policy URL, and this keeps
 * that page generated from the Markdown so the two can never drift apart.
 *
 * Deliberately supports only the subset of Markdown PRIVACY.md actually uses:
 * headings, paragraphs, lists, tables, links, bold, inline code and rules.
 *
 * Run: npm run build:privacy
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline formatting. Runs after escaping, so it only ever emits its own tags. */
function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
      // Only http(s) and mailto links; anything else stays as plain text so a
      // javascript: URL can never be produced.
      if (!/^(https?:|mailto:)/i.test(href)) return label;
      return `<a href="${href}" rel="noopener noreferrer">${label}</a>`;
    })
    // Autolinks arrive here already escaped, so the angle brackets are entities.
    .replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, '<a href="$1" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderMarkdown(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`);
    buf.length = 0;
  };
  const paragraph = [];

  while (i < lines.length) {
    const line = lines[i];

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph(paragraph);
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      flushParagraph(paragraph);
      out.push('<hr />');
      i++;
      continue;
    }

    // Table: a header row followed by a separator row of dashes.
    if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
      flushParagraph(paragraph);
      const cells = (row) =>
        row.split('|').slice(1, -1).map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        body.push(cells(lines[i]));
        i++;
      }
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
      );
      continue;
    }

    const listMatch = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      flushParagraph(paragraph);
      const ordered = /\d/.test(listMatch[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*]|\d+\.)\s+(.*)$/);
        if (!m) break;
        items.push(`<li>${inline(m[2])}</li>`);
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph(paragraph);
      i++;
      continue;
    }

    paragraph.push(line.trim());
    i++;
  }
  flushParagraph(paragraph);
  return out.join('\n');
}

const markdown = readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8');
const body = renderMarkdown(markdown);

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="FuelPilot privacy policy — the app collects nothing and stores everything on your device." />
    <meta name="theme-color" content="#0A0A0A" />
    <meta name="color-scheme" content="dark light" />
    <title>Privacy Policy — FuelPilot</title>
    <link rel="icon" type="image/png" sizes="32x32" href="./favicon-32.png" />
    <style>
      :root {
        --bg: #0a0a0a; --surface: #141414; --border: #2c2c2e;
        --text: #f5f5f3; --muted: #8e8e93; --accent: #60a5fa;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #f2f2f7; --surface: #ffffff; --border: #c6c6c8;
          --text: #1c1c1e; --muted: #6c6c70; --accent: #2563eb;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; background: var(--bg); color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        line-height: 1.65; font-size: 16px;
      }
      main { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; }
      h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 .5rem; }
      h2 { font-size: 1.25rem; margin: 2.5rem 0 .75rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
      h3 { font-size: 1.05rem; margin: 1.75rem 0 .5rem; }
      p, li { color: var(--text); }
      a { color: var(--accent); }
      code {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 5px; padding: .1em .35em; font-size: .875em;
      }
      ul, ol { padding-left: 1.35rem; }
      li { margin: .35rem 0; }
      hr { border: none; border-top: 1px solid var(--border); margin: 2.5rem 0; }
      /* Tables must scroll rather than force the page sideways on a phone. */
      table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: .93rem; }
      th, td { text-align: left; padding: .6rem .7rem; border: 1px solid var(--border); vertical-align: top; }
      th { background: var(--surface); font-weight: 600; }
      .table-wrap { overflow-x: auto; }
      .back { display: inline-block; margin-top: 3rem; color: var(--muted); font-size: .9rem; }
    </style>
  </head>
  <body>
    <main>
${body
  .split('\n')
  .map((l) => (l.startsWith('<table>') ? `<div class="table-wrap">${l}</div>` : l))
  .map((l) => `      ${l}`)
  .join('\n')}
      <a class="back" href="./">← Back to FuelPilot</a>
    </main>
  </body>
</html>
`;

mkdirSync(join(ROOT, 'public'), { recursive: true });
writeFileSync(join(ROOT, 'public', 'privacy.html'), html);
console.log('wrote public/privacy.html');
