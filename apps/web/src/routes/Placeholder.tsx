import { t } from '../strings';

export function Placeholder({ title, phase }: { title: string; phase: number }) {
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-xl font-semibold">{title}</h1>
      <p className="text-muted">{t.placeholder(phase)}</p>
    </section>
  );
}
