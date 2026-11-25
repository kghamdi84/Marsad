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
  const [password2, setPassword2] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  // Password first (ADR 0039); members create their own accounts (ADR 0040); the emailed link stays as a fallback.
  const [step, setStep] = useState<'password' | 'signup' | 'email' | 'code'>('password');
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

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setNotice(null);
    if (password.length < 10) return setError(t.signIn.passwordTooShort);
    if (password !== password2) return setError(t.signIn.passwordsDiffer);
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setBusy(false);
    if (error) {
      setError(error.code === 'user_already_exists' ? t.signIn.alreadyRegistered : error.message);
      return;
    }
    // With email confirmation off, Supabase signs the new member in at once; otherwise it sends a confirmation.
    if (!data.session) {
      setNotice(t.signIn.confirmSent(email.trim()));
      setStep('password');
    }
  }

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    // shouldCreateUser false: accounts are created only on the Create account form, with a password.
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
          <Button type="button" onClick={() => setStep('signup')}>
            {t.signIn.createAccount}
          </Button>
        </form>
      ) : step === 'signup' ? (
        <form onSubmit={createAccount} className="flex flex-col gap-4">
          <h2 className="font-semibold">{t.signIn.createTitle}</h2>
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
            id="new-password"
            label={t.signIn.newPasswordLabel}
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            id="new-password-2"
            label={t.signIn.confirmPasswordLabel}
            type="password"
            autoComplete="new-password"
            required
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? t.signIn.creating : t.signIn.create}
          </Button>
          <LinkButton type="button" onClick={() => setStep('password')}>
            {t.signIn.haveAccount}
          </LinkButton>
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
      {notice && (
        <p className="text-sm" role="status">
          {notice}
        </p>
      )}
      <ErrorText message={error} />
    </Panel>
  );
}
