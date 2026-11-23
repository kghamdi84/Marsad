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
        className="min-h-11 rounded-sm border border-line bg-bg px-3 text-lg text-fg"
      />
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto mt-16 flex w-full max-w-md flex-col gap-4 rounded-sm border border-line bg-surface p-6">
      <h1 className="text-xl font-semibold">{title}</h1>
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
