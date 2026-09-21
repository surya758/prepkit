import { describe, expect, it, vi } from 'vitest';
import { checkUrl, isPrivateAddress, parseHttpUrl } from '../src';
import type { LookupFn } from '../src';

const resolvesTo = (...addresses: string[]): LookupFn => async () => addresses.map((address) => ({ address }));
const production = (lookup: LookupFn = resolvesTo('93.184.216.34')) => ({ allowPrivateHosts: false, lookup });

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.15.255.255', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('parseHttpUrl', () => {
  it('accepts http and https and returns the parsed URL', () => {
    const result = parseHttpUrl('  https://example.com/careers  ');
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.url.href).toBe('https://example.com/careers');
  });

  it.each([
    ['not a url', 'INVALID_URL'],
    ['', 'INVALID_URL'],
    ['example.com', 'INVALID_URL'],
    ['file:///etc/passwd', 'UNSUPPORTED_PROTOCOL'],
    ['ftp://example.com/', 'UNSUPPORTED_PROTOCOL'],
    ['javascript:alert(1)', 'UNSUPPORTED_PROTOCOL'],
    ['https://user:secret@example.com/', 'CREDENTIALS_IN_URL'],
  ])('rejects %j as %s', (raw, code) => {
    expect(parseHttpUrl(raw)).toMatchObject({ ok: false, code });
  });
});

describe('checkUrl in production mode', () => {
  it('allows a host that resolves to a public address', async () => {
    expect(await checkUrl('https://example.com/', production())).toMatchObject({ ok: true });
  });

  it.each([
    'http://localhost:8099/acme/',
    'http://app.localhost/',
    'http://127.0.0.1/',
    'http://[::1]:3000/',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.0.10/admin',
    // Alternative spellings of 127.0.0.1 that URL parsing normalises
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://127.1/',
  ])('rejects %s without a DNS lookup', async (raw) => {
    const lookup = vi.fn(resolvesTo('93.184.216.34'));
    expect(await checkUrl(raw, production(lookup))).toMatchObject({ ok: false, code: 'PRIVATE_ADDRESS' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a public-looking name that resolves to a private address', async () => {
    const result = await checkUrl('https://internal.example.com/', production(resolvesTo('10.0.0.7')));
    expect(result).toMatchObject({ ok: false, code: 'PRIVATE_ADDRESS' });
  });

  it('rejects a name with mixed public and private records', async () => {
    const result = await checkUrl('https://rebind.example.com/', production(resolvesTo('93.184.216.34', '127.0.0.1')));
    expect(result).toMatchObject({ ok: false, code: 'PRIVATE_ADDRESS' });
  });

  it('reports a name that does not resolve', async () => {
    const failing: LookupFn = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await checkUrl('https://nope.invalid/', production(failing))).toMatchObject({ ok: false, code: 'DNS_FAILURE' });
    expect(await checkUrl('https://empty.invalid/', production(resolvesTo()))).toMatchObject({ ok: false, code: 'DNS_FAILURE' });
  });
});

describe('checkUrl with allowPrivateHosts (batch CLI, local development)', () => {
  it('allows the localhost fixture URL from Appendix B, with no DNS lookup', async () => {
    const lookup = vi.fn(resolvesTo('127.0.0.1'));
    const result = await checkUrl('http://localhost:8099/acme/', { allowPrivateHosts: true, lookup });
    expect(result).toMatchObject({ ok: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('still rejects bad schemes and credentials', async () => {
    const options = { allowPrivateHosts: true };
    expect(await checkUrl('file:///etc/passwd', options)).toMatchObject({ ok: false, code: 'UNSUPPORTED_PROTOCOL' });
    expect(await checkUrl('http://a:b@localhost/', options)).toMatchObject({ ok: false, code: 'CREDENTIALS_IN_URL' });
  });
});
