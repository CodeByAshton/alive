// First-run screen for native shells (iOS app) or any client that hasn't
// been pointed at a vault server yet.

import { useState } from 'react';
import { setServerConfig } from '../lib/config';

export function Connect() {
  const [url, setUrl] = useState('http://');
  const [key, setKey] = useState('vault-dev-key');
  const [error, setError] = useState('');

  const submit = async () => {
    const base = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/.+/.test(base)) {
      setError('Enter the server URL, e.g. http://192.168.1.20:8787');
      return;
    }
    setError('checking…');
    try {
      const res = await fetch(`${base}/api/models?key=${encodeURIComponent(key.trim())}`);
      if (res.status === 401) {
        setError('The vault key was rejected.');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setError("Couldn't reach a vault server there.");
      return;
    }
    setServerConfig(base, key);
    location.reload();
  };

  return (
    <div className="connect">
      <div className="connect-card">
        <div className="connect-mark">V</div>
        <h1>Connect to your vault</h1>
        <p>
          Enter the address of your vault server — the machine running the Vault desktop app or{' '}
          <span className="mono">npm run server</span>.
        </p>
        <label>
          Server URL
          <input
            value={url}
            placeholder="http://192.168.1.20:8787"
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label>
          Vault key
          <input value={key} autoCapitalize="off" autoCorrect="off" onChange={(e) => setKey(e.target.value)} />
        </label>
        {error && <div className="connect-error mono">{error}</div>}
        <button className="connect-go" onClick={submit}>
          Open vault
        </button>
      </div>
    </div>
  );
}
