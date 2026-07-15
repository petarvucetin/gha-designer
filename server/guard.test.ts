import { describe, expect, it } from 'vitest';
import { checkRequest } from './guard';

const mk = (h: Record<string, string>, method = 'POST') => ({ method, headers: h });

describe('checkRequest', () => {
  it('accepts localhost hosts on any port, with or without Origin', () => {
    expect(checkRequest(mk({ host: 'localhost:5173', 'content-type': 'application/json' })).ok).toBe(true);
    expect(checkRequest(mk({ host: '127.0.0.1:7791', origin: 'http://localhost:5173', 'content-type': 'application/json' })).ok).toBe(true);
    expect(checkRequest(mk({ host: '[::1]:7791', 'content-type': 'application/json' })).ok).toBe(true);
  });
  it('rejects foreign hosts and origins and null origin', () => {
    expect(checkRequest(mk({ host: 'evil.com:7791', 'content-type': 'application/json' }))).toMatchObject({ ok: false, code: 403 });
    expect(checkRequest(mk({ host: 'localhost:7791', origin: 'https://evil.com', 'content-type': 'application/json' }))).toMatchObject({ ok: false, code: 403 });
    expect(checkRequest(mk({ host: 'localhost:7791', origin: 'null', 'content-type': 'application/json' }))).toMatchObject({ ok: false, code: 403 });
  });
  it('accepts the packaged Tauri webview origin (http://tauri.localhost) but still rejects other foreign origins', () => {
    expect(checkRequest(mk({ host: '127.0.0.1:7791', origin: 'http://tauri.localhost' }, 'GET')).ok).toBe(true);
    expect(checkRequest(mk({ host: '127.0.0.1:7791', origin: 'http://evil.com' }, 'GET'))).toMatchObject({ ok: false, code: 403 });
  });
  it('415s non-JSON POSTs but lets GETs through without content-type', () => {
    expect(checkRequest(mk({ host: 'localhost:7791', 'content-type': 'text/plain' }))).toMatchObject({ ok: false, code: 415 });
    expect(checkRequest(mk({ host: 'localhost:7791' }, 'GET')).ok).toBe(true);
  });
  it('415s a non-JSON PUT (guard extends from POST to PUT)', () => {
    expect(checkRequest(mk({ host: 'localhost:7791', 'content-type': 'text/plain' }, 'PUT'))).toMatchObject({ ok: false, code: 415 });
    expect(checkRequest(mk({ host: 'localhost:7791', 'content-type': 'application/json' }, 'PUT')).ok).toBe(true);
  });
});
