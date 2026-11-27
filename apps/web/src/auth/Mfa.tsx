import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { t } from '../strings';
import { Button, ErrorText, Field, LinkButton, Panel } from '../components/ui';

interface Enrollment {
  factorId: string;
  qr: string;
  secret: string;
}

export function Mfa({ mode, onDone }: { mode: 'enroll' | 'verify'; onDone: () => void }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let cancelled = false;
    (async () => {
      const factors = await client.auth.mfa.listFactors();
      if (factors.error) return setError(factors.error.message);
      if (mode === 'verify') {
        const verified = factors.data.totp.find((f) => f.status === 'verified');
        if (!cancelled) setFactorId(verified?.id ?? null);
        return;
      }
      // Remove abandoned, unverified factors so enrollment can start cleanly.
      for (const f of factors.data.all.filter((f) => f.status === 'unverified')) {
        await client.auth.mfa.unenroll({ factorId: f.id });
      }
      const res = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Marsad' });
      if (cancelled) return;
      if (res.error) return setError(res.error.message);
      setEnrollment({
        factorId: res.data.id,
        qr: res.data.totp.qr_code,
        secret: res.data.totp.secret,
      });
      setFactorId(res.data.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !factorId) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <Panel title={mode === 'enroll' ? t.mfa.enrollTitle : t.mfa.verifyTitle}>
      <p className="text-muted">{mode === 'enroll' ? t.mfa.enrollBody : t.mfa.verifyBody}</p>
      {enrollment && (
        <div className="flex flex-col items-center gap-2">
          <img
            src={enrollment.qr}
            alt={t.mfa.qrAlt}
            width={200}
            height={200}
            className="bg-ink p-2"
          />
          <p className="text-sm text-muted">{t.mfa.secretLabel}</p>
          <code className="break-all select-all text-sm">{enrollment.secret}</code>
        </div>
      )}
      <form onSubmit={confirm} className="flex flex-col gap-4">
        <Field
          id="totp"
          label={t.mfa.codeLabel}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" disabled={busy || !factorId}>
          {busy ? t.mfa.confirming : t.mfa.confirm}
        </Button>
      </form>
      <LinkButton type="button" onClick={() => void supabase?.auth.signOut()}>
        {t.nav.signOut}
      </LinkButton>
      <ErrorText message={error} />
    </Panel>
  );
}
