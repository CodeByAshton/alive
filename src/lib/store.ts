import { create } from 'zustand';
import type { ApprovalRequest, AssistantMode, Device, Notice, Provider, StreamState, VaultRecord } from './types';

interface VaultState {
  records: Map<string, VaultRecord>;
  presence: Device[];
  connected: boolean;
  hydrated: boolean;
  providers: Provider[];
  activePath: string | null; // file open in the editor
  activeChat: string | null; // chat folder open in the chat pane
  openTabs: string[]; // editor tab strip, in open order
  railTab: 'files' | 'chats' | 'devices';
  mainView: 'chat' | 'note' | 'graph' | 'skills' | 'connectors' | 'automations' | 'plugins';
  editorMode: 'read' | 'edit';
  streams: Map<string, StreamState>;
  approvals: ApprovalRequest[];
  notices: Notice[];
  paused: boolean;
  mode: AssistantMode;
  pendingWrites: number; // offline outbox depth

  applyRecords: (records: VaultRecord[]) => void;
  setPresence: (devices: Device[]) => void;
  setConnected: (connected: boolean) => void;
  setHydrated: () => void;
  setProviders: (providers: Provider[]) => void;
  setActivePath: (path: string | null) => void;
  setActiveChat: (path: string | null) => void;
  setRailTab: (tab: 'files' | 'chats' | 'devices') => void;
  setMainView: (view: 'chat' | 'note' | 'graph' | 'skills' | 'connectors' | 'automations' | 'plugins') => void;
  setEditorMode: (mode: 'read' | 'edit') => void;
  openFile: (path: string, mode?: 'read' | 'edit') => void;
  closeTab: (path: string) => void;
  updateStream: (chatPath: string, fn: (s: StreamState) => StreamState) => void;
  clearStream: (chatPath: string) => void;
  addApproval: (approval: ApprovalRequest) => void;
  removeApproval: (id: string) => void;
  addNotice: (notice: Notice) => void;
  removeNotice: (id: string) => void;
  setPaused: (paused: boolean) => void;
  setMode: (mode: AssistantMode) => void;
  setPendingWrites: (n: number) => void;
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
  openTabs: [],
  railTab: 'files',
  mainView: 'chat',
  editorMode: 'read',
  streams: new Map(),
  approvals: [],
  notices: [],
  paused: false,
  mode: 'ask',
  pendingWrites: 0,

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
  openFile: (path, mode = 'read') =>
    set((state) => ({
      activePath: path,
      editorMode: mode,
      mainView: 'note',
      openTabs: state.openTabs.includes(path) ? state.openTabs : [...state.openTabs, path],
    })),

  // Closing the active tab activates its left neighbor; closing the last tab
  // returns to the chat.
  closeTab: (path) =>
    set((state) => {
      const openTabs = state.openTabs.filter((p) => p !== path);
      if (state.activePath !== path) return { openTabs };
      if (!openTabs.length) return { openTabs, activePath: null, mainView: 'chat' as const };
      const idx = Math.max(0, state.openTabs.indexOf(path) - 1);
      return { openTabs, activePath: openTabs[Math.min(idx, openTabs.length - 1)] };
    }),

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

  addApproval: (approval) =>
    set((state) => ({ approvals: [...state.approvals.filter((a) => a.id !== approval.id), approval] })),
  removeApproval: (id) => set((state) => ({ approvals: state.approvals.filter((a) => a.id !== id) })),
  addNotice: (notice) => set((state) => ({ notices: [...state.notices.slice(-3), notice] })),
  removeNotice: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
  setPaused: (paused) => set({ paused }),
  setMode: (mode) => set({ mode }),
  setPendingWrites: (pendingWrites) => set({ pendingWrites }),
}));
