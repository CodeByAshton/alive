// Vault desktop app (Electron). Installing this is the whole story on a
// computer: it boots the vault server locally, opens the UI against it, and
// runs the node harness — so this machine immediately shows up as a capable
// device (vault editing + run_command) for every surface attached to the
// same vault, including your phone.
//
// Point it at a remote vault instead with VAULT_REMOTE=https://your-server
// (then it skips the local server and just runs UI + harness against it).

const { app, BrowserWindow, shell } = require('electron');
const { fork } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const PORT = Number(process.env.VAULT_PORT || 8787);
const REMOTE = process.env.VAULT_REMOTE || '';
const children = [];

function forkChild(script, env) {
  const proc = fork(script, [], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
    // Forked scripts live outside the asar archive (see asarUnpack).
  });
  children.push(proc);
  return proc;
}

function root(...parts) {
  // In a packaged app __dirname is .../app.asar/desktop; the server/agent
  // trees are unpacked next to it.
  return path.join(__dirname, '..', ...parts).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

function waitForHealth(base, tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http
        .get(`${base}/api/health`, (res) => (res.statusCode === 200 ? resolve() : retry(n)))
        .on('error', () => retry(n));
    };
    const retry = (n) => (n <= 0 ? reject(new Error('vault server did not start')) : setTimeout(() => attempt(n - 1), 250));
    attempt(tries);
  });
}

async function boot() {
  let base = REMOTE.replace(/\/+$/, '');

  if (!base) {
    forkChild(root('server', 'index.mjs'), {
      PORT: String(PORT),
      NODE_ENV: 'production',
      // Vault data lives in the OS-standard app-data dir, not the install dir.
      VAULT_DATA: path.join(app.getPath('userData'), 'vault.json'),
    });
    base = `http://127.0.0.1:${PORT}`;
  }

  await waitForHealth(base);

  // The node harness makes this machine an exec-capable device.
  // TODO: trust boundary — surface per-command confirmation in the UI before
  // this ships beyond a prototype.
  forkChild(root('agent', 'vault-node.mjs'), {
    VAULT_SERVER: base.replace(/^http/, 'ws'),
    VAULT_WORKSPACE: process.env.VAULT_WORKSPACE || os.homedir(),
    VAULT_NODE_NAME: os.hostname().split('.')[0],
  });

  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0e0f11',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`${base}/?surface=desktop`);
}

app.whenReady().then(boot);
app.on('window-all-closed', () => app.quit());
app.on('quit', () => {
  for (const proc of children) {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  }
});
