// First-run screen for native shells (iOS app) or any client that hasn't
// been pointed at a vault server yet.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
    <div className="connect grid h-full place-items-center p-6">
      <Card className="w-full max-w-sm gap-4">
        <CardHeader>
          <div className="mb-1 grid size-9 place-items-center rounded-xl border text-base font-bold">V</div>
          <CardTitle>Connect to your vault</CardTitle>
          <CardDescription>
            Enter the address of your vault server — the machine running the Vault desktop app or{' '}
            <code className="font-mono text-xs">npm run server</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
            Server URL
            <Input
              value={url}
              placeholder="http://192.168.1.20:8787"
              autoCapitalize="off"
              autoCorrect="off"
              className="font-mono"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
            Vault key
            <Input
              value={key}
              autoCapitalize="off"
              autoCorrect="off"
              className="font-mono"
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          {error && <div className="connect-error font-mono text-xs text-destructive">{error}</div>}
          <Button className="connect-go mt-1" onClick={submit}>
            Open vault
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
