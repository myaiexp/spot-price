// CORS preflight contract (audit #7127 / CVE-2026-69207, finding #7620):
// allowHeaders is a static list so a preflight cannot feed
// Access-Control-Request-Headers into hono's header parser, and production
// origins exclude the local Vite server. Frontend GETs send no custom headers.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createApp } from './app.js';
import type { Db } from './db/connection.js';

const stubDb = {} as unknown as Db;

afterEach(() => {
  vi.unstubAllEnvs();
});

function preflight(app: ReturnType<typeof createApp>, origin: string, extra: Record<string, string> = {}) {
  return app.request('/api/health', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      ...extra,
    },
  });
}

describe('CORS preflight (audit #7127)', () => {
  it('OPTIONS does not echo Access-Control-Request-Headers', async () => {
    const app = createApp(stubDb);
    const res = await preflight(app, 'https://mase.fi', {
      'Access-Control-Request-Headers': 'x-custom, content-type',
    });
    const allow = res.headers.get('Access-Control-Allow-Headers') ?? '';
    expect(allow.toLowerCase()).toContain('content-type');
    expect(allow.toLowerCase()).not.toContain('x-custom');
  });
});

describe('CORS origins (finding #7620)', () => {
  it('production allows https://mase.fi', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await preflight(createApp(stubDb), 'https://mase.fi');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://mase.fi');
  });

  it('production does not allow http://localhost:5173', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await preflight(createApp(stubDb), 'http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('non-production allows http://localhost:5173', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const res = await preflight(createApp(stubDb), 'http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});
