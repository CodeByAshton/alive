// Account auth (Supabase). The server's /api/config says which mode it runs:
//   'key'      — shared vault key, no sign-in (dev / self-host default)
//   'accounts' — each user signs in (email+password via Supabase Auth) and
//                gets their own isolated vault; the access token authenticates
//                the WS and API calls.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getVaultKey } from './device';

export interface AuthConfig {
  auth: 'key' | 'accounts';
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
}

let config: AuthConfig = { auth: 'key', supabaseUrl: null, supabaseAnonKey: null };
let client: SupabaseClient | null = null;

export async function loadAuthConfig(httpBase: string): Promise<AuthConfig> {
  try {
    const res = await fetch(`${httpBase}/api/config`);
    if (res.ok) config = { auth: 'key', supabaseUrl: null, supabaseAnonKey: null, ...(await res.json()) };
  } catch {
    /* older server without /api/config -> key mode */
  }
  if (config.auth === 'accounts' && config.supabaseUrl && config.supabaseAnonKey) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey);
  }
  return config;
}

export function authMode(): 'key' | 'accounts' {
  return config.auth;
}

export function getAuthClient(): SupabaseClient | null {
  return client;
}

export async function getAccessToken(): Promise<string | null> {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function hasSession(): Promise<boolean> {
  return (await getAccessToken()) !== null;
}

// The query-string credential for WS/API calls in the current mode.
export async function authQuery(): Promise<string> {
  if (config.auth === 'accounts') {
    const token = await getAccessToken();
    return `token=${encodeURIComponent(token ?? '')}`;
  }
  return `key=${encodeURIComponent(getVaultKey())}`;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!client) return 'Accounts are not enabled on this server.';
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function signUp(email: string, password: string): Promise<string | null> {
  if (!client) return 'Accounts are not enabled on this server.';
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) return error.message;
  // With email confirmation on, there's no session yet — tell the user.
  if (!data.session) return 'Check your email to confirm your account, then sign in.';
  return null;
}

export async function signOut(): Promise<void> {
  await client?.auth.signOut();
}
