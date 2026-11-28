/**
 * Sign-in and two-factor strings.
 * Import `t` from `strings.ts`, not this module (ADR 0051).
 */

export const configMissing = {
  title: 'Configuration missing',
  body: 'This build has no Supabase address or publishable key. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Netlify, then redeploy.',
} as const;

export const signIn = {
  title: 'Sign in',
  emailLabel: 'Email',
  passwordLabel: 'Password',
  signInPassword: 'Sign in',
  signingIn: 'Signing in',
  useLink: 'Email me a sign-in link instead',
  noAccount: 'New here? Friends of the owner can join as members.',
  createAccount: 'Create an account',
  createIntro:
    'Members see Watch, Study and Regime. Alerts, briefs and the journal stay with the owner.',
  newPasswordLabel: 'Password, at least 10 characters',
  confirmPasswordLabel: 'Password again',
  create: 'Create account',
  creating: 'Creating',
  haveAccount: 'I already have an account',
  meter: (n: number) => `${Math.min(n, 10)} of 10 characters`,
  linkTitle: 'Get a sign-in link',
  sendLink: 'Email me a link',
  sending: 'Sending',
  linkNote: 'Only existing accounts get a link. New accounts need a password.',
  usePassword: 'Use my password',
  checkTitle: 'Check your email',
  linkSentPage: (email: string) =>
    `We sent a link to ${email}. Open it on this device, or paste the link or the 6-digit code here.`,
  linkSentPhone: (email: string) =>
    `We sent a link to ${email}. Open it on this phone, or paste the link or 6-digit code.`,
  codeLabel: 'Link or code',
  verify: 'Verify',
  verifying: 'Verifying',
  useDifferentEmail: 'Use a different email',
  footer: 'Not investment advice. Prices are end of day unless marked Live.',
  unavailable: 'Unavailable',
  unavailableBody: 'Sign-in service is not responding. Your data is safe; try again in a minute.',
  enterEmail: 'Enter your email.',
  enterPassword: 'Enter your password.',
  passwordTooShort: 'Use at least 10 characters.',
  passwordsDiffer: 'The two passwords differ.',
  notALinkOrCode: 'Paste the whole link or the 6-digit code.',
  confirmSent: (email: string) => `Account created. Confirm it from the email sent to ${email}.`,
  linkFailed: (reason: string) =>
    `The sign-in link did not work (${reason}). Each link works once and expires after a short time. Request a new one.`,
  alreadyRegistered:
    'An account with this email already exists. Sign in instead; to set a new password, run the Set password workflow in GitHub (SETUP step 2b).',
  badCredentials:
    'The email or password is wrong. To set a new password, run the Set password workflow in GitHub (SETUP step 2b).',
} as const;

export const mfa = {
  enrollTitle: 'Set up two-factor authentication',
  enrollBody:
    'Marsad requires an authenticator app. Scan the QR code with your authenticator app (for example, iOS Passwords, 1Password or Google Authenticator), then enter the 6-digit code it shows.',
  secretLabel: 'Or enter this setup key by hand',
  qrAlt: 'QR code for your authenticator app',
  verifyTitle: 'Two-factor check',
  verifyBody: 'Enter the 6-digit code from your authenticator app.',
  codeLabel: 'Authenticator code',
  confirm: 'Confirm',
  confirming: 'Checking',
} as const;
