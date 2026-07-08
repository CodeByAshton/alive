#!/usr/bin/env node
// Vault node harness — run this on a computer to make it a capable device in
// your vault. While it's connected (and your session is active), the
// assistant's per-turn toolset gains the ability to act on this machine:
// vault editing plus shell commands in the workspace you point it at
// (git, builds, tests, installed CLIs like `claude` or `codex`).
//
//   node agent/vault-node.mjs --server ws://localhost:8787 --workspace ~/dev/myproject
//
// Options (env fallbacks in parens):
//   --server     ws(s)://host:port of the vault server   (VAULT_SERVER)
//   --key        shared vault key                        (VAULT_KEY)
//   --workspace  directory commands run in               (VAULT_WORKSPACE, default cwd)
//   --name       device name shown in presence           (VAULT_NODE_NAME, default host)
//   --allow      comma list of allowed first words,      (VAULT_ALLOW)
//                e.g. "git,npm,node,ls,cat" — unset allows everything
//   --audit      audit log path (JSONL, one line/exec)   (VAULT_AUDIT,
//                default ~/.vault-node/audit.jsonl)
//
// Every command is already screen-confirmed server-side (or covered by the
// vault's Auto mode); the allowlist here is defense in depth on the machine
// itself, and the audit log is the machine's own record of what ran.
// TODO: trust boundary — device attestation is the remaining piece.

import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

function arg(flag, envKey, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env[envKey] || fallback;
}

const SERVER = arg('--server', 'VAULT_SERVER', 'ws://localhost:8787');
const KEY = arg('--key', 'VAULT_KEY', 'vault-dev-key');
const WORKSPACE = path.resolve(arg('--workspace', 'VAULT_WORKSPACE', process.cwd()));
const NAME = arg('--name', 'VAULT_NODE_NAME', os.hostname().split('.')[0]);
const ALLOW = (arg('--allow', 'VAULT_ALLOW', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const AUDIT = path.resolve(arg('--audit', 'VAULT_AUDIT', path.join(os.homedir(), '.vault-node', 'audit.jsonl')));

const MAX_OUTPUT = 8000;
let backoff = 1000;

function log(...parts) {
  console.log(new Date().toISOString().slice(11, 19), ...parts);
}

function audit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT), { recursive: true });
    fs.appendFileSync(AUDIT, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch (err) {
    log(`audit write failed: ${err.message}`);
  }
}

// Confinement: the resolved cwd must be the workspace or inside it.
// (A plain startsWith check would let /workspace-evil slip past.)
function insideWorkspace(cwd) {
  const rel = path.relative(WORKSPACE, cwd);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Optional allowlist: the command's first word must match. Shell chaining
// (;, |, &&, $(), backticks, redirects) is refused outright when an
// allowlist is set, since it would smuggle other programs past the check.
// This is defense in depth — the server-side approval flow is the real gate.
function allowed(command) {
  if (!ALLOW.length) return { ok: true };
  if (/[;|&`$<>]/.test(command)) {
    return { ok: false, reason: `shell operators are blocked by this machine's allowlist (${ALLOW.join(', ')})` };
  }
  const first = command.trim().split(/\s+/)[0];
  if (!ALLOW.includes(first)) {
    return { ok: false, reason: `"${first}" is not in this machine's allowlist (${ALLOW.join(', ')})` };
  }
  return { ok: true };
}

function runCommand(input) {
  return new Promise((resolve) => {
    const started = Date.now();
    const done = (result) => {
      audit({
        command: String(input.command ?? ''),
        cwd: input.cwd ?? null,
        ok: result.ok,
        ms: Date.now() - started,
        bytes: result.output.length,
      });
      resolve(result);
    };
    const cwd = input.cwd ? path.resolve(WORKSPACE, input.cwd) : WORKSPACE;
    if (!insideWorkspace(cwd)) {
      done({ ok: false, output: `cwd escapes the workspace (${WORKSPACE})` });
      return;
    }
    const gate = allowed(String(input.command ?? ''));
    if (!gate.ok) {
      log(`refused: ${input.command}`);
      done({ ok: false, output: gate.reason });
      return;
    }
    log(`$ ${input.command}${input.cwd ? `  (in ${input.cwd})` : ''}`);
    exec(input.command, { cwd, timeout: 75_000, maxBuffer: 1024 * 1024, shell: true }, (err, stdout, stderr) => {
      let output = [stdout, stderr].filter(Boolean).join('\n---stderr---\n').trim();
      if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + `\n…(truncated)`;
      if (err && err.killed) {
        done({ ok: false, output: `${output}\n(command timed out)`.trim() });
      } else if (err) {
        done({ ok: true, output: `${output}\n(exit code ${err.code ?? 1})`.trim() });
      } else {
        done({ ok: true, output: output || '(no output)' });
      }
    });
  });
}

function connect() {
  // Capabilities are assigned by the server from the device type.
  const params = new URLSearchParams({
    key: KEY,
    deviceId: `node-${NAME}`,
    deviceType: 'node',
  });
  const url = `${SERVER.replace(/\/$/, '')}/ws?${params}`;
  const ws = new WebSocket(url);

  ws.on('open', () => {
    backoff = 1000;
    log(`connected to ${SERVER} as node-${NAME}`);
    log(`workspace: ${WORKSPACE}`);
    if (ALLOW.length) log(`allowlist: ${ALLOW.join(', ')}`);
    log(`audit log: ${AUDIT}`);
    log('this machine can now act for the assistant — Ctrl-C to revoke');
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type !== 'tool_exec') return;
    let result;
    try {
      if (msg.name === 'run_command') result = await runCommand(msg.input ?? {});
      else result = { ok: false, output: `unknown tool: ${msg.name}` };
    } catch (err) {
      result = { ok: false, output: err.message };
    }
    ws.send(JSON.stringify({ type: 'tool_exec_result', id: msg.id, ...result }));
  });

  ws.on('close', (code, reason) => {
    if (code === 4001) {
      log('rejected: bad vault key');
      process.exit(1);
    }
    log(`disconnected (${code}) — retrying in ${backoff / 1000}s`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15_000);
  });
  ws.on('error', () => ws.close());
}

connect();
