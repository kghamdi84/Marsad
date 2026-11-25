/**
 * Email through Resend's API when RESEND_API_KEY and BRIEF_EMAIL_TO are set (SETUP step 9); otherwise undefined,
 * and the caller records delivery as not configured. Never logs the key or the address.
 */
export function resendSender(): ((subject: string, text: string) => Promise<void>) | undefined {
  const apiKey = process.env['RESEND_API_KEY']?.trim();
  const to = process.env['BRIEF_EMAIL_TO']?.trim();
  const from = process.env['BRIEF_EMAIL_FROM']?.trim() || 'Marsad <onboarding@resend.dev>';
  if (!apiKey || !to) return undefined;
  return async (subject, text) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}`);
  };
}
