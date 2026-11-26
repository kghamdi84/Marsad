import { t } from '../strings';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`min-h-11 rounded-sm border border-line bg-raised px-4 font-medium text-fg hover:border-focus disabled:opacity-50 ${className}`}
    />
  );
}

export function LinkButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`min-h-11 px-2 text-muted underline underline-offset-4 hover:text-fg ${className}`}
    />
  );
}

export function Field({
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="min-h-12 rounded-xl border border-line bg-bg px-3 text-lg text-fg aria-[invalid=true]:border-down"
      />
    </div>
  );
}

/** A centred card (sign-in, setup notices): full screen on a phone, at most 420 wide from 760 px. */
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col gap-4 bg-bg px-4 pt-[calc(env(safe-area-inset-top)+3rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)] tablet:mt-16 tablet:min-h-0 tablet:rounded-2xl tablet:border tablet:border-line tablet:bg-surface tablet:p-6">
      <span className="flex flex-col leading-none">
        <span lang="ar" dir="rtl" className="text-sm text-muted">
          {t.shell.logoArabic}
        </span>
        <span className="text-[1.375rem] font-bold text-white">{t.appName}</span>
      </span>
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      {children}
    </main>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-down">
      Error: {message}
    </p>
  );
}
