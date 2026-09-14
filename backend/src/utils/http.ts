// Shared helpers for upstream price-API calls: timed JSON fetch + safe error formatting.

/**
 * Abort an upstream price-API request after this many ms. The payloads are small
 * JSON, so a hung or stalled upstream — not a slow-but-progressing one — is the
 * only thing this bound guards against; it stops collection from blocking forever.
 */
export const FETCH_TIMEOUT_MS = 15_000;

/**
 * Max length of an upstream HTTP statusText we'll echo into a log/error message.
 * A legitimate reason phrase ("Internal Server Error", "Service Unavailable") is
 * well under this; the bound stops a hostile/garbage upstream from flooding logs.
 */
const MAX_STATUS_TEXT_LEN = 100;

/**
 * Sanitize an upstream-controlled HTTP statusText before it enters an error or
 * log message. The reason phrase is copied verbatim from the upstream response
 * line, so treat it as untrusted: replace every control character — C0 (incl.
 * CR/LF/TAB, which could forge or split log lines), DEL, and C1 — with a space,
 * collapse the resulting runs, and bound the length. Returns '' when nothing
 * printable survives, so callers can drop it and keep just the status code.
 */
export function sanitizeStatusText(statusText: string): string {
  let out = '';
  for (const ch of statusText) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    out += isControl ? ' ' : ch;
  }
  return out.replace(/ +/g, ' ').trim().slice(0, MAX_STATUS_TEXT_LEN);
}

/**
 * Format an upstream HTTP failure into a safe, bounded error suffix. Keeps the
 * status CODE verbatim (the useful diagnostic) and appends the statusText only
 * after sanitizing it — so upstream-controlled text can't inject into logs.
 */
export function httpErrorDetail(response: Response): string {
  const detail = sanitizeStatusText(response.statusText);
  return detail ? `${response.status} ${detail}` : String(response.status);
}

/**
 * GET an upstream price API and return its parsed JSON body as `unknown` —
 * callers own shape validation. Every collector fetches through here so the
 * timeout, redirect policy and error wording are defined once:
 *   - AbortSignal.timeout(FETCH_TIMEOUT_MS) bounds a hung upstream;
 *   - redirect 'follow' is fetch's default, stated so a policy change is a
 *     visible edit (the sahkotin.fi backfill was written against a redirecting
 *     endpoint);
 *   - a non-2xx response throws `<sourceName> API error: <status> <text>` with
 *     the statusText sanitized by httpErrorDetail.
 */
export async function fetchUpstreamJson(url: string, sourceName: string): Promise<unknown> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${sourceName} API error: ${httpErrorDetail(response)}`);
  }

  return response.json();
}
