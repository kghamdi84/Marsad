import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

/** The owner's weekly export folders, newest first, with their files. */
export async function listExports(): Promise<{ date: string; files: string[] }[]> {
  const { data: u, error: ue } = await client().auth.getUser();
  if (ue || !u.user) throw new Error('Not signed in.');
  const root = await client()
    .storage.from('exports')
    .list(u.user.id, {
      limit: 12,
      sortBy: { column: 'name', order: 'desc' },
    });
  if (root.error) throw new Error(`exports: ${root.error.message}`);
  const dates = (root.data ?? []).map((f) => f.name).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n));
  return Promise.all(
    dates.map(async (date) => {
      const l = await client().storage.from('exports').list(`${u.user.id}/${date}`, { limit: 50 });
      if (l.error) throw new Error(`exports: ${l.error.message}`);
      return { date, files: (l.data ?? []).map((f) => f.name).sort() };
    }),
  );
}

/** Downloads one export file and hands it to the browser as a file to save. */
export async function downloadExport(date: string, file: string): Promise<void> {
  const { data: u, error: ue } = await client().auth.getUser();
  if (ue || !u.user) throw new Error('Not signed in.');
  const r = await client().storage.from('exports').download(`${u.user.id}/${date}/${file}`);
  if (r.error) throw new Error(`exports: ${r.error.message}`);
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marsad-${date}-${file}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
