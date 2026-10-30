import { useState, useEffect } from 'react';

import { APP_VERSION } from '@/shared/constants';

export const useServerVersion = () => {
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch('/health');
        const data = await response.json();
        // `data.version` is the version the server process is actually running.
        // `APP_VERSION` is baked into the frontend bundle at build time, so it
        // reflects the on-disk build. If they differ, the app was rebuilt but
        // the server process was not restarted, and DB-backed actions may
        // silently fail until it is.
        if (typeof data.version === 'string' && data.version.length > 0) {
          setRestartRequired(data.version !== APP_VERSION);
        }
      } catch {
        // No restart hint on error
      }
    };
    void fetchHealth();
  }, []);

  return { currentVersion: APP_VERSION, restartRequired };
};
