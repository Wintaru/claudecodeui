import type { IncomingHttpHeaders } from 'node:http';

import { isLoopbackHost } from '../../../shared/networkHosts.js';

type LoopbackAddress = { port: string };

// `same-origin` is the CloudCLI page itself; `none` is an address typed in the
// address bar. `same-site` is refused because it includes other loopback ports.
const OWN_PAGE_FETCH_SITES: ReadonlySet<string> = new Set(['same-origin', 'none']);

function readLoopbackAddress(url: string): LoopbackAddress | null {
  try {
    const { hostname, port } = new URL(url);
    return isLoopbackHost(hostname) ? { port } : null;
  } catch {
    return null;
  }
}

/**
 * True when a request reached a loopback address of this server from the
 * page this server serves, or from a program that is not a browser.
 *
 * - The `Host` check stops DNS rebinding: a foreign name that resolves to
 *   127.0.0.1 still arrives with that foreign name in `Host`.
 * - The `Origin` check stops foreign pages and pages of other local servers:
 *   the page must be on a loopback address with the same port as `Host`.
 *   Browsers send `Origin` on every POST, and a sandboxed or file page sends
 *   `null`.
 * - `Sec-Fetch-Site` must say same-origin when a browser sends it.
 *
 * A program that is not a browser can send any headers, so a process that
 * can reach the loopback port passes. That includes other accounts on this
 * computer, and containers or WSL distributions that can reach the host's
 * loopback address.
 */
export function isLocalPageRequest(headers: IncomingHttpHeaders): boolean {
  const server = headers.host === undefined ? null : readLoopbackAddress(`http://${headers.host}`);
  if (server === null) {
    return false;
  }

  if (headers.origin !== undefined) {
    const page = readLoopbackAddress(headers.origin);
    if (page === null || page.port !== server.port) {
      return false;
    }
  }

  const fetchSite = headers['sec-fetch-site'];
  return fetchSite === undefined || (typeof fetchSite === 'string' && OWN_PAGE_FETCH_SITES.has(fetchSite));
}
