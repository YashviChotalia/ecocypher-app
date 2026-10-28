import { useState } from 'react';
import { repo } from '../lib/data';
import { useSession } from '../lib/session';

export function Auth() {
  const { reload } = useSession();
  const [mode, setMode] = useState<'signin' | 'signup' | 'magic'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ tone: 'pass' | 'fail'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'signin') { await repo.signIn(email, password); await reload(); }
      else if (mode === 'signup') {
        const r = await repo.signUp(email, password, name);
        if (r.needsConfirmation) setMsg({ tone: 'pass', text: 'Check your inbox to confirm your email, then sign in.' });
        else await reload();
      } else { await repo.sendMagicLink(email); setMsg({ tone: 'pass', text: 'Sign-in link sent. Open it on this device.' }); }
    } catch (err) { setMsg({ tone: 'fail', text: (err as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <img src="/logo.svg" alt="" width={64} height={64} />
        <h1>EcoCypher ESG</h1>
        <p className="muted">Evidence-backed sustainability claims for your company.</p>
        <div className="segmented" role="tablist">
          <button aria-pressed={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
          <button aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>Create account</button>
          <button aria-pressed={mode === 'magic'} onClick={() => setMode('magic')}>Email link</button>
        </div>
        <form className="stack" onSubmit={(e) => void submit(e)}>
          {mode === 'signup' && <label className="field">Your name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>}
          <label className="field">Work email<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
          {mode !== 'magic' && <label className="field">Password<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>}
          {msg && <div className={`note ${msg.tone}`} role="status">{msg.text}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send sign-in link'}</button>
        </form>
      </div>
    </div>
  );
}
