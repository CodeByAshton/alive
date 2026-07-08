export interface VaultRecord {
  path: string;
  type: 'file' | 'folder';
  content: string;
  ctime: number;
  mtime: number;
  deleted: boolean;
  rev: number;
}

export interface Device {
  deviceId: string;
  deviceType: 'desktop' | 'phone';
  capabilities: string[];
  state: 'active' | 'background';
  connectedAt: number;
}

export interface Provider {
  id: string;
  label: string;
  available: boolean;
  models: string[];
}

export interface ToolActivity {
  name: string;
  status: 'running' | 'done' | 'error';
}

export interface StreamState {
  active: boolean;
  text: string;
  tools: ToolActivity[];
  error?: string;
}

export interface ChatMessage {
  path: string;
  role: 'user' | 'assistant';
  body: string;
  timestamp?: string;
  device?: string;
  model?: string;
  provider?: string;
  toolsUsed?: string[];
  filesTouched?: string[];
}

// Permission modes, Claude-style: confirm each command, run unattended, or
// never run commands at all.
export type AssistantMode = 'ask' | 'auto' | 'readonly';

export interface ApprovalRequest {
  id: string;
  chatPath: string;
  command: string;
  cwd: string | null;
  kind: 'command' | 'connector' | 'automation';
}

// A live notification (automation firing, reflection suggestion) shown as a
// transient toast; the durable copy lives in .vault/notifications.md.
export interface Notice {
  id: string;
  title: string;
  message: string;
}
