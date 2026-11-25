import { useState, type FormEvent } from 'react';
import { landingUrl, supabase } from '../lib/supabase';
import { t } from '../strings';
import { Button, ErrorText, Field, LinkButton, Panel } from '../components/ui';
import { linkErrorFromUrl, parseSignInInput } from './signInInput';

/** An opened sign-in link that failed (used, expired, scanned) comes back with the reason in the address. */
function initialError(): string | null {
  const reason = linkErrorFromUrl(landingUrl);
  return reason ? t.signIn.linkFailed(reason) : null;
}

export function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  // Password first (ADR 0039); the emailed link stays as a fallback.
  const [step, setStep] = useState<'password' | 'email' | 'code'>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function signInWithPassword(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error)
      setError(error.code === 'invalid_credentials' ? t.signIn.badCredentials : error.message);
  }

  async function sendLink(e: FormEvent) {
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
    const input = parseSignInInput(code);
    if (input.kind === 'invalid') {
      setError(t.signIn.notALinkOrCode);
      return;
    }
    setBusy(true);
    setError(null);
    const { error } =
      input.kind === 'code'
        ? await supabase.auth.verifyOtp({ email: email.trim(), token: input.token, type: 'email' })
        : await supabase.auth.verifyOtp({ token_hash: input.tokenHash, type: input.type });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <Panel title={t.signIn.title}>
      {step === 'password' ? (
        <form onSubmit={signInWithPassword} className="flex flex-col gap-4">
          <Field
            id="email"
            label={t.signIn.emailLabel}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            id="password"
            label={t.signIn.passwordLabel}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? t.signIn.signingIn : t.signIn.signInPassword}
          </Button>
          <LinkButton type="button" onClick={() => setStep('email')}>
            {t.signIn.useLink}
          </LinkButton>
          <p className="text-sm text-muted">{t.signIn.noAccount}</p>
        </form>
      ) : step === 'email' ? (
        <form onSubmit={sendLink} className="flex flex-col gap-4">
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
            {busy ? t.signIn.sending : t.signIn.sendLink}
          </Button>
          <LinkButton type="button" onClick={() => setStep('password')}>
            {t.signIn.usePassword}
          </LinkButton>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <p className="text-muted">{t.signIn.linkSent(email.trim())}</p>
          <p className="text-sm text-muted">{t.signIn.pasteHelp}</p>
          <Field
            id="code"
            label={t.signIn.codeLabel}
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
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
