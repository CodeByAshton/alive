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
//
// TODO: trust boundary — this executes shell commands sent by the harness on
// behalf of a (possibly voice-initiated) agent. A real version needs device
// attestation, per-command approval or an allowlist, and a kill switch.

import { exec } from 'node:child_process';
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

const MAX_OUTPUT = 8000;
let backoff = 1000;

function log(...parts) {
  console.log(new Date().toISOString().slice(11, 19), ...parts);
}

function runCommand(input) {
  return new Promise((resolve) => {
    const cwd = input.cwd ? path.resolve(WORKSPACE, input.cwd) : WORKSPACE;
    if (!cwd.startsWith(WORKSPACE)) {
      resolve({ ok: false, output: `cwd escapes the workspace (${WORKSPACE})` });
      return;
    }
    log(`$ ${input.command}${input.cwd ? `  (in ${input.cwd})` : ''}`);
    exec(input.command, { cwd, timeout: 75_000, maxBuffer: 1024 * 1024, shell: true }, (err, stdout, stderr) => {
      let output = [stdout, stderr].filter(Boolean).join('\n---stderr---\n').trim();
      if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + `\n…(truncated)`;
      if (err && err.killed) {
        resolve({ ok: false, output: `${output}\n(command timed out)`.trim() });
      } else if (err) {
        resolve({ ok: true, output: `${output}\n(exit code ${err.code ?? 1})`.trim() });
      } else {
        resolve({ ok: true, output: output || '(no output)' });
      }
    });
  });
}

function connect() {
  const params = new URLSearchParams({
    key: KEY,
    deviceId: `node-${NAME}`,
    deviceType: 'node',
    caps: 'read,write,exec',
  });
  const url = `${SERVER.replace(/\/$/, '')}/ws?${params}`;
  const ws = new WebSocket(url);

  ws.on('open', () => {
    backoff = 1000;
    log(`connected to ${SERVER} as node-${NAME}`);
    log(`workspace: ${WORKSPACE}`);
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
