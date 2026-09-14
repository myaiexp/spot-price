// @vitest-environment node
// Pins the Pörssisähkö CSP contract (finding #7954): no inline boot script,
// so script-src can omit 'unsafe-inline', and the committed nginx snippet
// (live copy: /etc/nginx/sites-enabled/default location /porssi) enumerates
// the page's real third parties. A location with its own add_header inherits
// NONE of the server-level security headers — they must be re-listed.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function directive(csp: string, name: string): string {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  expect(found, `CSP missing ${name}`).toBeTruthy();
  return found!;
}

describe('frontend/index.html boot (finding #7954)', () => {
  const html = read('frontend/index.html');

  it('loads the dashboard as an external module, with no inline script bodies', () => {
    expect(html).toMatch(/<script\s+type="module"\s+src="\.\/js\/main\.js">\s*<\/script>/);
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
      (m) => m[2].trim() !== '',
    );
    expect(inline, 'inline <script> bodies force script-src unsafe-inline').toEqual([]);
  });

  it('has no parser-inserted style attributes (style-src stays strict)', () => {
    expect(html).not.toMatch(/\sstyle="/);
  });
});

describe('frontend/js/main.js auto-boot (finding #7954)', () => {
  it('calls init() when not imported by Vitest', () => {
    const src = read('frontend/js/main.js');
    expect(src).toMatch(
      /if\s*\(\s*!globalThis\.process\?\.env\?\.VITEST\s*\)\s*\{\s*init\(\);?\s*\}/,
    );
  });
});

describe('deploy/nginx-porssi.conf (finding #7954)', () => {
  const conf = read('deploy/nginx-porssi.conf');
  // A block's body runs to its first column-0 closing brace, so the static
  // block's assertions can't be satisfied by headers in the API block.
  const blockAfter = (opener: RegExp) => (conf.split(opener)[1] ?? '').split(/^\}/m)[0];
  const staticBlock = blockAfter(/location \/porssi\s*\{/);
  const apiBlock = blockAfter(/location \/porssi\/api\/\s*\{/);

  it('proxies /porssi/api/ to the backend with the /porssi prefix stripped (finding #9954)', () => {
    expect(apiBlock).toMatch(/proxy_pass\s+http:\/\/127\.0\.0\.1:3600\/api\/;/);
    expect(apiBlock).not.toMatch(/try_files/);
    expect(staticBlock).not.toMatch(/proxy_pass/);
  });

  it('re-lists framing/nosniff/HSTS and sets a porssi-scoped CSP', () => {
    expect(staticBlock).toMatch(/add_header\s+Strict-Transport-Security\s+"max-age=31536000; includeSubDomains"/);
    expect(staticBlock).toMatch(/add_header\s+X-Frame-Options\s+"DENY"/);
    expect(staticBlock).toMatch(/add_header\s+X-Content-Type-Options\s+"nosniff"/);
    expect(staticBlock).toMatch(/add_header\s+Referrer-Policy\s+"strict-origin-when-cross-origin"/);
    expect(staticBlock).toMatch(/add_header\s+Content-Security-Policy\s+"[^"]*frame-ancestors 'none'/);
  });

  it('allows the page\'s real third parties and nothing via default-src *', () => {
    const m = staticBlock.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"/);
    expect(m).not.toBeNull();
    const csp = m![1];
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
    expect(csp).not.toMatch(/default-src[^;]*\*/);

    const script = directive(csp, 'script-src');
    expect(script).toContain("'self'");
    expect(script).toContain('https://cdn.jsdelivr.net');
    expect(script).toContain('https://static.cloudflareinsights.com');
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval/);

    const style = directive(csp, 'style-src');
    expect(style).toContain("'self'");
    expect(style).toContain('https://fonts.googleapis.com');
    expect(style).not.toMatch(/unsafe-inline/);
    expect(directive(csp, 'style-src-attr')).toBe("style-src-attr 'unsafe-inline'");

    expect(directive(csp, 'font-src')).toContain('https://fonts.gstatic.com');
    expect(directive(csp, 'connect-src')).toContain('https://cloudflareinsights.com');
    expect(directive(csp, 'img-src')).toContain('data:');
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'base-uri')).toContain("'self'");
    expect(directive(csp, 'form-action')).toContain("'self'");
  });

  it('keeps the static try_files fallback', () => {
    expect(staticBlock).toMatch(/^\s*try_files\s+\$uri\s+\$uri\/\s+\/porssi\/index\.html;/m);
  });
});
