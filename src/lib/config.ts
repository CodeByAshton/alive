// Server connection config. In a browser (or the Electron shell, which loads
// the UI from its own local server) the vault server is same-origin and no
// setup is needed. In a native shell (Capacitor iOS) — or when the user
// points a browser at a different vault — the server URL is explicit and
// persisted.

export interface ServerConfig {
  httpBase: string; // '' means same-origin
  wsBase: string;
}

export function isNativeShell(): boolean {
  return location.protocol === 'capacitor:' || location.protocol === 'file:';
}

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function getServerConfig(): ServerConfig | null {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('server');
  if (fromUrl) localStorage.setItem('vault-server', normalize(fromUrl));

  const saved = localStorage.getItem('vault-server');
  if (saved) {
    const http = normalize(saved).replace(/^ws/, 'http');
    return { httpBase: http, wsBase: http.replace(/^http/, 'ws') };
  }

  if (isNativeShell()) return null; // needs first-run setup

  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  return { httpBase: '', wsBase: `${wsProto}://${location.host}` };
}

export function setServerConfig(url: string, key: string): void {
  localStorage.setItem('vault-server', normalize(url));
  if (key) localStorage.setItem('vault-key', key.trim());
}

export function clearServerConfig(): void {
  localStorage.removeItem('vault-server');
}
