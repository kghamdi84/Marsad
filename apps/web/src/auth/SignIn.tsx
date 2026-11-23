import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { t } from '../strings';
import { Button, ErrorText, Field, LinkButton, Panel } from '../components/ui';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    // shouldCreateUser false: sign-ups are closed; unknown emails get no account.
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setStep('code');
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <Panel title={t.signIn.title}>
      {step === 'email' ? (
        <form onSubmit={sendCode} className="flex flex-col gap-4">
          <Field
            id="email"
            label={t.signIn.emailLabel}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? t.signIn.sending : t.signIn.sendCode}
          </Button>
          <p className="text-sm text-muted">{t.signIn.noAccount}</p>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <p className="text-muted">{t.signIn.codeSent(email.trim())}</p>
          <Field
            id="code"
            label={t.signIn.codeLabel}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,10}"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? t.signIn.verifying : t.signIn.verify}
          </Button>
          <LinkButton type="button" onClick={() => setStep('email')}>
            {t.signIn.useDifferentEmail}
          </LinkButton>
        </form>
      )}
      <ErrorText message={error} />
    </Panel>
  );
}
