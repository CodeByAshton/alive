// Device identity for this client. The surface (?surface=phone) decides the
// device descriptor advertised to the presence registry — a phone is a
// conversational/voice surface, a desktop is a full vault surface.

export type Surface = 'desktop' | 'phone';

export function getSurface(): Surface {
  const params = new URLSearchParams(location.search);
  if (params.get('surface') === 'phone') return 'phone';
  if (params.get('surface') === 'desktop') return 'desktop';
  return window.matchMedia('(max-width: 640px)').matches ? 'phone' : 'desktop';
}

export function getDeviceId(surface: Surface): string {
  const key = `vault-device-id-${surface}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = `${surface}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

// Capabilities this device contributes to per-turn tool assembly.
// TODO: trust boundary — in a real system these would be attested and granted
// server-side, not declared by the client.
export function getCapabilities(surface: Surface): string[] {
  return surface === 'phone' ? ['read', 'voice'] : ['read', 'write'];
}

export function getVaultKey(): string {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('key');
  if (fromUrl) {
    localStorage.setItem('vault-key', fromUrl);
    return fromUrl;
  }
  return localStorage.getItem('vault-key') || 'vault-dev-key';
}
