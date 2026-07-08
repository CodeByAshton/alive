// Sign-in screen for accounts mode: email + password via Supabase Auth.
// Each account gets its own vault — same continuity, same devices story.

import { useState } from 'react';
import { Loader2, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signIn, signUp } from '../lib/auth';

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    if (!email || !password || busy) return;
    setBusy(true);
    setNotice(null);
    const error = mode === 'signin' ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (error) setNotice(error);
    else onSignedIn();
  };

  return (
    <div className="signin grid h-full place-items-center bg-neutral-50 p-6">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border bg-white p-6 shadow-xs">
        <div className="flex flex-col items-center gap-1.5 py-2 text-center">
          <span className="grid size-10 place-items-center rounded-xl border bg-neutral-50">
            <Lock className="size-4 text-neutral-500" />
          </span>
          <h1 className="mt-1 text-base font-semibold tracking-tight">Vault</h1>
          <p className="text-xs text-neutral-400">
            {mode === 'signin' ? 'Sign in to open your vault.' : 'Create an account — you get your own vault.'}
          </p>
        </div>
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            type="email"
            value={email}
            placeholder="Email"
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value.trim())}
          />
          <Input
            type="password"
            value={password}
            placeholder="Password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
          {notice && <p className="signin-notice px-0.5 text-xs text-neutral-500">{notice}</p>}
          <Button type="submit" disabled={!email || !password || busy} className="mt-1">
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        <button
          className="cursor-pointer text-center text-xs text-neutral-400 hover:text-neutral-700"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setNotice(null);
          }}
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
