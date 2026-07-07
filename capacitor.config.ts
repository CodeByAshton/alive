import type { CapacitorConfig } from '@capacitor/cli';

// iPhone app shell. The web client detects the native origin and shows the
// connect screen (server URL + vault key) on first run; after that it behaves
// exactly like the phone browser surface — same vault, same continuity.
const config: CapacitorConfig = {
  appId: 'com.codebyashton.vault',
  appName: 'Vault',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    backgroundColor: '#0e0f11',
  },
};

export default config;
