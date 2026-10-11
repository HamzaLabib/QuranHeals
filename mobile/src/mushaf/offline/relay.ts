import { apiBaseUrl } from '@/services/apiBase';
import { fetchWithTimeout } from '@/services/fetchWithTimeout';

import { RelayError, type OfflineRelay } from './relayTypes';

export { RelayError, type OfflineRelay } from './relayTypes';

/**
 * Our backend's relay of the offline QPC V1 Mushaf (no Quran Foundation
 * credentials ever reach the app). Public endpoints: offline reading never
 * depends on a signed-in session.
 */

const TIMEOUT_MS = 30_000;

async function get(path: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${apiBaseUrl}/api/mushaf/qpc-v1/offline${path}`, { headers: { Accept: 'application/json' } }, TIMEOUT_MS);
  } catch {
    throw new RelayError('The offline Mushaf server could not be reached', 'offline');
  }
  if (response.status === 503) throw new RelayError('The offline Mushaf is not available right now', 'unavailable');
  if (!response.ok) throw new RelayError(`The offline Mushaf server answered ${response.status}`, 'http');
  return response;
}

export const offlineRelay: OfflineRelay = {
  async manifest() {
    const body = (await (await get('/manifest')).json()) as { data?: unknown };
    return body?.data;
  },
  async chunk(version, index) {
    const response = await get(`/versions/${encodeURIComponent(version)}/chunks/${index}`);
    try {
      return await response.text();
    } catch {
      throw new RelayError('The download was interrupted', 'offline');
    }
  },
};
