import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { landingUrl, supabase } from '../lib/supabase';
import { t } from '../strings';
import { linkErrorFromUrl, parseSignInInput } from './signInInput';

/** An opened sign-in link that failed (used, expired, scanned) comes back with the reason in the address. */
function initialError(): string | null {
  const reason = linkErrorFromUrl(landingUrl);
  return reason ? t.signIn.linkFailed(reason) : null;
}

/** True when the sign-in service did not answer at all (network error), not when it said no. */
type AuthFailure = {
  name?: string | undefined;
  message: string;
  status?: number | undefined;
  code?: string | undefined;
};

function isUnreachable(error: AuthFailure): boolean {
  return (
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    /failed to fetch|network|load failed/i.test(error.message)
  );
}

type Step = 'password' | 'signup' | 'email' | 'code';

/** Phone sizes are rem so Dynamic Type scales them; from 760 px the card uses the desktop pixel sizes. */
const fieldBox =
  'min-h-[3.375rem] rounded-[14px] border bg-surface px-4 text-[1.0625rem] text-ink tablet:min-h-[52px] tablet:rounded-xl tablet:px-[14px] tablet:text-[17px]';
const primaryBtn =
  'min-h-14 rounded-[14px] border-0 bg-accent text-[1.0625rem] font-bold text-accent-ink disabled:opacity-50 tablet:min-h-[54px] tablet:rounded-xl tablet:text-[17px]';
const quietBtn =
  'min-h-12 rounded-[14px] border-0 bg-transparent text-base text-up tablet:min-h-11 tablet:rounded-none tablet:text-[15px]';
const outlineBtn =
  'min-h-12 rounded-[14px] border border-white/35 bg-transparent text-base font-semibold text-ink tablet:min-h-[52px] tablet:rounded-xl tablet:text-[16px]';

function SignInField({
  label,
  id,
  borderColor = 'rgba(255,255,255,0.24)',
  children,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  borderColor?: string;
  children?: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="flex flex-col gap-1.5 text-[0.875rem] text-muted tablet:text-[14px]"
    >
      {label}
      <input
        id={id}
        {...props}
        style={{ borderColor }}
        className={`${fieldBox} font-[inherit] tracking-normal`}
      />
      {children}
    </label>
  );
}

export function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  // Password first (ADR 0039); members create their own accounts (ADR 0040); the emailed link stays as a fallback.
  const [step, setStep] = useState<Step>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [offline, setOffline] = useState(false);

  const go = (next: Step) => () => {
    setStep(next);
    setError(null);
  };

  function fail(e: AuthFailure) {
    if (isUnreachable(e)) {
      setOffline(true);
      return;
    }
    setOffline(false);
    setError(
      e.code === 'invalid_credentials'
        ? t.signIn.badCredentials
        : e.code === 'user_already_exists'
          ? t.signIn.alreadyRegistered
          : e.message,
    );
  }

  async function signInWithPassword(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setNotice(null);
    if (!email.trim()) return setError(t.signIn.enterEmail);
    if (!password) return setError(t.signIn.enterPassword);
    setBusy(true);
    setError(null);
    setOffline(false);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) fail(error);
  }

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setNotice(null);
    if (!email.trim()) return setError(t.signIn.enterEmail);
    if (newPassword.length < 10) return setError(t.signIn.passwordTooShort);
    if (newPassword !== newPassword2) return setError(t.signIn.passwordsDiffer);
    setBusy(true);
    setError(null);
    setOffline(false);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: newPassword,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setBusy(false);
    if (error) return fail(error);
    // With email confirmation off, Supabase signs the new member in at once; otherwise it sends a confirmation.
    if (!data.session) {
      setNotice(t.signIn.confirmSent(email.trim()));
      setPassword('');
      setStep('password');
    }
  }

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (!email.trim()) return setError(t.signIn.enterEmail);
    setBusy(true);
    setError(null);
    setOffline(false);
    // shouldCreateUser false: accounts are created only on the Create account form, with a password.
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/` },
    });
    setBusy(false);
    if (error) fail(error);
    else {
      setCode('');
      setStep('code');
    }
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
    setOffline(false);
    const { error } =
      input.kind === 'code'
        ? await supabase.auth.verifyOtp({ email: email.trim(), token: input.token, type: 'email' })
        : await supabase.auth.verifyOtp({ token_hash: input.tokenHash, type: input.type });
    setBusy(false);
    if (error) fail(error);
  }

  const n = newPassword.length;
  const mismatch = newPassword2.length > 0 && newPassword2 !== newPassword;
  const title =
    step === 'password'
      ? t.signIn.title
      : step === 'signup'
        ? t.signIn.createAccount
        : step === 'email'
          ? t.signIn.linkTitle
          : t.signIn.checkTitle;

  return (
    <div className="flex min-h-dvh flex-col bg-bg tablet:items-center tablet:justify-center tablet:px-4 tablet:py-6">
      <main
        aria-labelledby="signin-h"
        className="flex w-full flex-1 flex-col gap-6 px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] tablet:max-w-[420px] tablet:flex-none tablet:rounded-3xl tablet:bg-raised tablet:px-6 tablet:py-8"
      >
        <div className="flex items-start justify-between pt-3 tablet:pt-0">
          <span className="flex flex-col gap-0.5">
            <span lang="ar" className="text-start text-[1.25rem] text-muted tablet:text-[18px]">
              {t.shell.logoArabic}
            </span>
            <span className="text-[2.25rem] leading-none font-bold text-ink tablet:text-[32px]">
              {t.appName}
            </span>
          </span>
        </div>

        {offline && (
          <div
            role="alert"
            className="flex gap-2.5 rounded-xl border border-alarm/40 bg-alarm/12 px-3.5 py-3"
          >
            <span className="flex-none self-start rounded-[4px] bg-bg/50 px-2 py-0.5 text-[0.75rem] font-bold whitespace-nowrap text-alarm">
              {t.signIn.unavailable}
            </span>
            <span className="text-[0.875rem] leading-[1.4]">{t.signIn.unavailableBody}</span>
          </div>
        )}

        <form
          onSubmit={
            step === 'password'
              ? signInWithPassword
              : step === 'signup'
                ? createAccount
                : step === 'email'
                  ? sendLink
                  : verify
          }
          noValidate
          className="flex flex-1 flex-col gap-3.5 tablet:flex-none"
        >
          <h1
            id="signin-h"
            className="m-0 text-2xl font-bold text-ink tablet:text-[20px] tablet:font-semibold"
          >
            {title}
          </h1>

          {step === 'signup' && (
            <span className="text-[0.9375rem] leading-normal text-fg tablet:text-[14px]">
              {t.signIn.createIntro}
            </span>
          )}
          {step === 'email' && (
            <span className="text-[0.9375rem] leading-normal text-fg tablet:hidden">
              {t.signIn.linkNote}
            </span>
          )}
          {step === 'code' && (
            <>
              <span className="text-[0.9375rem] leading-normal text-fg tablet:hidden">
                {t.signIn.linkSentPhone(email.trim())}
              </span>
              <span className="hidden text-[15px] leading-[1.45] text-fg tablet:inline">
                {t.signIn.linkSentPage(email.trim())}
              </span>
            </>
          )}

          {notice && (
            <span
              role="status"
              className="rounded-xl bg-up/14 px-3.5 py-3 text-[0.9375rem] text-fg tablet:py-2.5 tablet:text-[14px]"
            >
              {notice}
            </span>
          )}

          {step === 'password' && (
            <>
              <SignInField
                id="email"
                label={t.signIn.emailLabel}
                type="email"
                inputMode="email"
                autoComplete="username"
                enterKeyHint="next"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
              <SignInField
                id="password"
                label={t.signIn.passwordLabel}
                type="password"
                autoComplete="current-password"
                enterKeyHint="go"
                autoCapitalize="none"
                spellCheck={false}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
              />
            </>
          )}

          {step === 'signup' && (
            <>
              <SignInField
                id="email"
                label={t.signIn.emailLabel}
                type="email"
                inputMode="email"
                autoComplete="username"
                enterKeyHint="next"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
              <SignInField
                id="new-password"
                label={t.signIn.newPasswordLabel}
                type="password"
                autoComplete="new-password"
                enterKeyHint="next"
                autoCapitalize="none"
                spellCheck={false}
                borderColor={n > 0 && n < 10 ? 'var(--color-warn)' : 'var(--color-line-strong)'}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError(null);
                }}
              >
                <span
                  role="img"
                  aria-label={t.signIn.meter(n)}
                  className="flex gap-[3px] pt-0.5 tablet:pt-0"
                >
                  {Array.from({ length: 10 }, (_, i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-[2px] ${
                        i < n ? (n >= 10 ? 'bg-up' : 'bg-warn') : 'bg-ink/16'
                      }`}
                    />
                  ))}
                </span>
              </SignInField>
              <SignInField
                id="new-password-2"
                label={t.signIn.confirmPasswordLabel}
                type="password"
                autoComplete="new-password"
                enterKeyHint="go"
                autoCapitalize="none"
                spellCheck={false}
                borderColor={mismatch ? 'var(--color-down)' : 'var(--color-line-strong)'}
                aria-invalid={mismatch}
                value={newPassword2}
                onChange={(e) => {
                  setNewPassword2(e.target.value);
                  setError(null);
                }}
              />
            </>
          )}

          {step === 'email' && (
            <SignInField
              id="email"
              label={t.signIn.emailLabel}
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="send"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
            />
          )}

          {step === 'code' && (
            <SignInField
              id="code"
              label={t.signIn.codeLabel}
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="go"
              spellCheck={false}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(null);
              }}
            />
          )}

          {error && (
            <span role="alert" className="text-[0.9375rem] text-down tablet:text-[14px]">
              {error}
            </span>
          )}

          <button type="submit" disabled={busy} className={`mt-1 ${primaryBtn}`}>
            {step === 'password'
              ? busy
                ? t.signIn.signingIn
                : t.signIn.signInPassword
              : step === 'signup'
                ? busy
                  ? t.signIn.creating
                  : t.signIn.create
                : step === 'email'
                  ? busy
                    ? t.signIn.sending
                    : t.signIn.sendLink
                  : busy
                    ? t.signIn.verifying
                    : t.signIn.verify}
          </button>

          {step === 'password' && (
            <>
              <button type="button" onClick={go('email')} className={quietBtn}>
                {t.signIn.useLink}
              </button>
              <div className="flex flex-col gap-2.5 border-t border-white/14 pt-3.5 max-tablet:border-t-0 max-tablet:pt-0">
                <span className="text-center text-[14px] text-muted max-tablet:hidden">
                  {t.signIn.noAccount}
                </span>
                <button type="button" onClick={go('signup')} className={outlineBtn}>
                  {t.signIn.createAccount}
                </button>
              </div>
            </>
          )}
          {step === 'signup' && (
            <button type="button" onClick={go('password')} className={quietBtn}>
              {t.signIn.haveAccount}
            </button>
          )}
          {step === 'email' && (
            <>
              <span className="hidden text-[13px] text-muted tablet:inline">
                {t.signIn.linkNote}
              </span>
              <button type="button" onClick={go('password')} className={quietBtn}>
                {t.signIn.usePassword}
              </button>
            </>
          )}
          {step === 'code' && (
            <button type="button" onClick={go('email')} className={quietBtn}>
              {t.signIn.useDifferentEmail}
            </button>
          )}
        </form>

        <span className="text-center text-[0.8125rem] text-muted tablet:text-start tablet:text-[12px]">
          {t.signIn.footer}
        </span>
      </main>
    </div>
  );
}
