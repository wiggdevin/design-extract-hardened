import { lookup as defaultLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export class UnsafeNetworkTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeNetworkTargetError';
    this.code = 'ERR_UNSAFE_NETWORK_TARGET';
  }
}

function normalizeHostname(hostname) {
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return unwrapped.replace(/\.$/, '').toLowerCase();
}

function parseIPv4(address) {
  const match = address.match(IPV4);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function isPublicIPv4(address) {
  const parts = parseIPv4(address);
  if (!parts) return false;
  const [a, b, c] = parts;

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 31 && c === 196) return false;
  if (a === 192 && b === 52 && c === 193) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 175 && c === 48) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function expandIPv6(address) {
  let normalized = address.toLowerCase();
  const dotted = normalized.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const octets = dotted.slice(2).map(Number);
    if (octets.some((part) => part < 0 || part > 255)) return null;
    const high = (octets[0] << 8) | octets[1];
    const low = (octets[2] << 8) | octets[3];
    normalized = `${dotted[1]}${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0) return null;
  const parts = halves.length === 2
    ? [...left, ...Array(missing).fill('0'), ...right]
    : left;
  if (parts.length !== 8 || !parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function isEmbeddedIPv4Range(parts) {
  const leadingZeroes = (end) => parts.slice(0, end).every((part) => part === 0);
  const isMapped = leadingZeroes(5) && parts[5] === 0xffff;
  const isCompatible = leadingZeroes(6);
  const isNat64 = parts[0] === 0x64 && parts[1] === 0xff9b && parts.slice(2, 6).every((part) => part === 0);
  return isMapped || isCompatible || isNat64;
}

function isPublicIPv6(address) {
  const parts = expandIPv6(address);
  if (!parts) return false;

  if (isEmbeddedIPv4Range(parts)) return false;
  if (parts[0] === 0x2002) return false;

  if (parts[0] < 0x2000 || parts[0] > 0x3fff) return false;
  // IANA special-purpose IPv6 ranges that sit inside 2000::/3 but are not
  // generally reachable. Be conservative: extraction does not need them.
  if (parts[0] === 0x2001 && parts[1] <= 0x01ff) return false;
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return false;
  if (parts[0] === 0x2620 && parts[1] === 0x004f && parts[2] === 0x8000) return false;
  if ((parts[0] & 0xfff0) === 0x3ff0) return false;
  return true;
}

export function isPublicIpAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPublicIPv4(address);
  if (family === 6) return isPublicIPv6(address);
  return false;
}

function isLocalHostname(hostname) {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local');
}

const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):(\d{2,5})$/;

// The one loopback allowance: an http origin on 127.0.0.1 or localhost with an
// explicit port, used only by `designlang fidelity --clone-local`.
export function loopbackOrigin(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl)); } catch {
    throw new UnsafeNetworkTargetError('--clone-local needs a URL such as http://127.0.0.1:4173');
  }
  if (parsed.username || parsed.password) throw new UnsafeNetworkTargetError('URL credentials are not allowed');
  if (!LOOPBACK_ORIGIN.test(parsed.origin)) {
    throw new UnsafeNetworkTargetError('--clone-local accepts only http://127.0.0.1:<port> or http://localhost:<port>');
  }
  return parsed.origin;
}

function allowedByOrigin(parsed, allowOrigin) {
  return typeof allowOrigin === 'string' && LOOPBACK_ORIGIN.test(allowOrigin) && parsed.origin === allowOrigin;
}

export function validateTargetUrl(rawUrl, { allowOrigin } = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { ok: false, reason: 'URL is required', status: 400 };
  }

  let input = rawUrl.trim();
  const suppliedScheme = input.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (suppliedScheme && suppliedScheme !== 'http' && suppliedScheme !== 'https') {
    return { ok: false, reason: 'Only http(s) URLs are allowed', status: 400 };
  }
  if (!suppliedScheme) input = `https://${input}`;

  let parsed;
  try { parsed = new URL(input); } catch {
    return { ok: false, reason: 'Invalid URL', status: 400 };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only http(s) URLs are allowed', status: 400 };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'URL credentials are not allowed', status: 400 };
  }
  if (allowedByOrigin(parsed, allowOrigin)) return { ok: true, url: parsed.toString() };

  const expectedPort = parsed.protocol === 'https:' ? '443' : '80';
  if (parsed.port && parsed.port !== expectedPort) {
    return { ok: false, reason: `Port not allowed (expected ${expectedPort})`, status: 400 };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) return { ok: false, reason: 'Missing hostname', status: 400 };
  if (isLocalHostname(hostname)) {
    return { ok: false, reason: 'Local hostnames are not allowed', status: 400 };
  }
  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    return { ok: false, reason: 'Only public IP addresses are allowed', status: 400 };
  }

  return { ok: true, url: parsed.toString() };
}

export async function resolvePublicTarget(rawUrl, { lookup = defaultLookup, allowOrigin } = {}) {
  const validation = validateTargetUrl(rawUrl, { allowOrigin });
  if (!validation.ok) throw new UnsafeNetworkTargetError(validation.reason);

  const parsed = new URL(validation.url);
  const hostname = normalizeHostname(parsed.hostname);
  if (allowedByOrigin(parsed, allowOrigin)) {
    return { url: validation.url, hostname, address: '127.0.0.1', family: 4, port: Number(parsed.port) };
  }
  const port = parsed.protocol === 'https:' ? 443 : 80;
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    return { url: validation.url, hostname, address: hostname, family: literalFamily, port };
  }

  let records;
  try {
    const result = await lookup(hostname, { all: true, verbatim: true });
    records = Array.isArray(result) ? result : [result];
  } catch {
    throw new UnsafeNetworkTargetError('Hostname could not be resolved');
  }

  if (records.length === 0) throw new UnsafeNetworkTargetError('Hostname could not be resolved');
  if (records.some((record) => !isPublicIpAddress(record.address))) {
    throw new UnsafeNetworkTargetError('Hostname must resolve only to public addresses');
  }

  const selected = records[0];
  return {
    url: validation.url,
    hostname,
    address: selected.address,
    family: selected.family || isIP(selected.address),
    port,
  };
}

export async function validateResolvedTargetUrl(rawUrl, options = {}) {
  try {
    const target = await resolvePublicTarget(rawUrl, options);
    return { ok: true, url: target.url };
  } catch (error) {
    const reason = error instanceof UnsafeNetworkTargetError
      ? error.message
      : 'URL safety validation failed';
    return { ok: false, reason, status: 400 };
  }
}
