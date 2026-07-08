import { create } from 'zustand';
import type { Device, Provider, StreamState, VaultRecord } from './types';

interface VaultState {
  records: Map<string, VaultRecord>;
  presence: Device[];
  connected: boolean;
  hydrated: boolean;
  providers: Provider[];
  activePath: string | null; // file open in the editor
  activeChat: string | null; // chat folder open in the chat pane
  railTab: 'files' | 'chats' | 'devices';
  mainView: 'chat' | 'note' | 'graph' | 'skills' | 'connectors';
  editorMode: 'read' | 'edit';
  streams: Map<string, StreamState>;

  applyRecords: (records: VaultRecord[]) => void;
  setPresence: (devices: Device[]) => void;
  setConnected: (connected: boolean) => void;
  setHydrated: () => void;
  setProviders: (providers: Provider[]) => void;
  setActivePath: (path: string | null) => void;
  setActiveChat: (path: string | null) => void;
  setRailTab: (tab: 'files' | 'chats' | 'devices') => void;
  setMainView: (view: 'chat' | 'note' | 'graph' | 'skills' | 'connectors') => void;
  setEditorMode: (mode: 'read' | 'edit') => void;
  openFile: (path: string, mode?: 'read' | 'edit') => void;
  updateStream: (chatPath: string, fn: (s: StreamState) => StreamState) => void;
  clearStream: (chatPath: string) => void;
}

const emptyStream = (): StreamState => ({ active: false, text: '', tools: [] });

export const useVault = create<VaultState>((set) => ({
  records: new Map(),
  presence: [],
  connected: false,
  hydrated: false,
  providers: [],
  activePath: null,
  activeChat: null,
  railTab: 'files',
  mainView: 'chat',
  editorMode: 'read',
  streams: new Map(),

  applyRecords: (incoming) =>
    set((state) => {
      const records = new Map(state.records);
      for (const rec of incoming) {
        const existing = records.get(rec.path);
        // Server revs win; optimistic local writes carry rev 0 and are
        // replaced by the echoed server record.
        if (existing && rec.rev !== 0 && existing.rev > rec.rev) continue;
        if (rec.deleted) records.delete(rec.path);
        else records.set(rec.path, rec);
      }
      return { records };
    }),

  setPresence: (presence) => set({ presence }),
  setConnected: (connected) => set({ connected }),
  setHydrated: () => set({ hydrated: true }),
  setProviders: (providers) => set({ providers }),
  setActivePath: (activePath) => set({ activePath }),
  setActiveChat: (activeChat) => set({ activeChat, ...(activeChat ? { mainView: 'chat' as const } : {}) }),
  setRailTab: (railTab) => set({ railTab }),
  setMainView: (mainView) => set({ mainView }),
  setEditorMode: (editorMode) => set({ editorMode }),
  openFile: (path, mode = 'read') => set({ activePath: path, editorMode: mode, mainView: 'note' }),

  updateStream: (chatPath, fn) =>
    set((state) => {
      const streams = new Map(state.streams);
      streams.set(chatPath, fn(streams.get(chatPath) ?? emptyStream()));
      return { streams };
    }),

  clearStream: (chatPath) =>
    set((state) => {
      const streams = new Map(state.streams);
      streams.delete(chatPath);
      return { streams };
    }),
}));
