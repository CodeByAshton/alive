// Device-presence registry — the cloud-backed source of truth for which
// devices are currently on. Tool assembly reads this per-turn; it is never
// told to the model directly.

import { EventEmitter } from 'node:events';

export class PresenceRegistry extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map(); // connId -> { deviceId, deviceType, capabilities, state, connectedAt }
  }

  join(connId, descriptor) {
    this.devices.set(connId, {
      ...descriptor,
      state: 'active',
      connectedAt: Date.now(),
    });
    this._emit();
  }

  setState(connId, state) {
    const d = this.devices.get(connId);
    if (!d) return;
    d.state = state; // 'active' | 'background'
    this._emit();
  }

  leave(connId) {
    if (this.devices.delete(connId)) this._emit();
  }

  // Active devices, deduped by deviceId (two tabs of one device count once).
  active() {
    const byId = new Map();
    for (const d of this.devices.values()) {
      if (d.state !== 'active') continue;
      const prev = byId.get(d.deviceId);
      if (!prev || d.connectedAt > prev.connectedAt) byId.set(d.deviceId, d);
    }
    return [...byId.values()];
  }

  snapshot() {
    return [...this.devices.values()].map(({ deviceId, deviceType, capabilities, state, connectedAt }) => ({
      deviceId,
      deviceType,
      capabilities,
      state,
      connectedAt,
    }));
  }

  _emit() {
    this.emit('update', this.snapshot());
  }
}
