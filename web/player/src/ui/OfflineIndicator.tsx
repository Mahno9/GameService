import { useSyncExternalStore } from 'react';
import {
  subscribeConnectivity,
  getConnectivitySnapshot,
} from '../state/sync';
import { useI18n } from '../i18n/index';

/**
 * Unobtrusive pill shown top-centre when the player has no server connection.
 * Visibility is driven by two combined signals:
 *   1. navigator.onLine / window online|offline events
 *   2. sync POST outcomes (notifySyncResult in state/sync.ts)
 */
export function OfflineIndicator(): JSX.Element | null {
  const t = useI18n();
  const isConnected = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
  );

  if (isConnected) return null;

  return (
    <div className="offline-pill" role="status" aria-live="polite">
      {t('net.offline')}
    </div>
  );
}
