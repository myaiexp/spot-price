// CORS preflight contract (audit #7127 / CVE-2026-69207): allowHeaders is a
// static list so a preflight cannot feed Access-Control-Request-Headers into
// hono's header parser. Frontend GETs send no custom headers.
import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';
import type { Db } from './db/connection.js';

const stubDb = {} as unknown as Db;

describe('CORS preflight (audit #7127)', () => {
  it('OPTIONS does not echo Access-Control-Request-Headers', async () => {
    const app = createApp(stubDb);
    const res = await app.request('/api/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://mase.fi',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-custom, content-type',
      },
    });
    const allow = res.headers.get('Access-Control-Allow-Headers') ?? '';
    expect(allow.toLowerCase()).toContain('content-type');
    expect(allow.toLowerCase()).not.toContain('x-custom');
  });
});
