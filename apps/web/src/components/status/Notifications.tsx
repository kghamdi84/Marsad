import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_LOCAL_ZONE, dualClock, etDate } from '@marsad/core';
import { Button, ErrorText } from '../ui';
import {
  PushDenied,
  PushEndpointRefused,
  createKeys,
  loadPushState,
  pushSupport,
  removeDevice,
  saveKeys,
  turnOnThisDevice,
  type PushDeviceRow,
  type PushState,
} from '../../lib/push';
import { cardClass } from '../Card';
import { t } from '../../strings';

const x = t.status.push;
const d = x.d;
const n = t.settings.notifications;
const stepCard = 'flex flex-col gap-2.5 rounded-[10px] border border-line bg-elev p-3.5';
const btnOutline =
  'min-h-11 rounded-lg border border-line-strong bg-transparent px-3.5 text-[13px] text-ink disabled:opacity-50';
function StepTitle({ n, children }: { n: number; children: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
      <span
        aria-hidden="true"
        className="flex size-6 items-center justify-center rounded-full bg-accent text-xs text-accent-ink"
      >
        {n}
      </span>
      {children}
    </h3>
  );
}

function when(iso: string | null): string {
  if (iso === null) return x.never;
  const d = new Date(iso);
  return `${etDate(d)} ${dualClock(d, DEFAULT_LOCAL_ZONE).label}`;
}

function stateText(d: PushDeviceRow): string {
  if (d.disabledAt !== null) return x.disabled;
  if (d.failures > 0) return x.failing(d.failures, d.lastError ?? '');
  return x.active;
}

function Keys({ state }: { state: PushState }) {
  const qc = useQueryClient();
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const make = useMutation({
    mutationFn: async () => {
      const k = await createKeys();
      await saveKeys(k.publicKey, state.devices.length > 0);
      return k.privateKey;
    },
    onSuccess: (k) => {
      setPrivateKey(k);
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: ['push'] });
    },
  });
  return (
    <div className={stepCard}>
      <StepTitle n={1}>{d.keys}</StepTitle>
      {state.publicKey === null ? (
        <>
          <p className="text-[13px] text-ink3">{x.noKeys}</p>
          <button
            type="button"
            className={`${btnOutline} self-start`}
            disabled={make.isPending}
            onClick={() => make.mutate()}
          >
            {x.createKeys}
          </button>
        </>
      ) : (
        <>
          <p className="text-[13px] text-up">{d.keysReady}</p>
          {confirm && (
            <p role="alert" className="text-[13px] text-down">
              {x.replaceWarning}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!confirm ? (
              <button type="button" className={btnOutline} onClick={() => setConfirm(true)}>
                {x.replace}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={btnOutline}
                  disabled={make.isPending}
                  onClick={() => make.mutate()}
                >
                  {x.replaceConfirm}
                </button>
                <button
                  type="button"
                  className="min-h-11 px-3.5 text-[13px] text-ink3"
                  onClick={() => setConfirm(false)}
                >
                  {x.cancel}
                </button>
              </>
            )}
          </div>
        </>
      )}
      {privateKey !== null && (
        <div className="flex flex-col gap-2 rounded-sm border border-line p-3">
          <label htmlFor="vapid-private" className="text-sm text-ink3">
            {x.privateKey}
          </label>
          <input
            id="vapid-private"
            readOnly
            value={privateKey}
            className="min-h-11 rounded-sm border border-line bg-canvas px-3 font-mono text-sm text-ink2"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            className="self-start"
            onClick={() =>
              void navigator.clipboard
                .writeText(privateKey)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {x.copy}
          </Button>
          {copied && <p className="text-sm">{x.copied}</p>}
          <p className="text-sm">{x.secretSteps}</p>
        </div>
      )}
      {make.isError && <ErrorText message={make.error.message} />}
    </div>
  );
}

function ThisDevice({ state }: { state: PushState }) {
  const qc = useQueryClient();
  const support = pushSupport();
  const on = useMutation({
    mutationFn: () => turnOnThisDevice(state.publicKey ?? ''),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['push'] }),
  });
  const active =
    state.thisEndpoint !== null &&
    state.devices.some((d) => d.endpoint === state.thisEndpoint && d.disabledAt === null);
  const error = on.error;
  return (
    <div className={stepCard}>
      <StepTitle n={2}>{d.device}</StepTitle>
      {support === 'needs-home-screen' && (
        <p className="text-[13px] text-ink2">{x.needsHomeScreen}</p>
      )}
      {support === 'unsupported' && <p className="text-[13px] text-ink3">{x.unsupported}</p>}
      {support === 'supported' &&
        (state.publicKey === null ? (
          <p className="text-[13px] text-ink3">{x.needsKeys}</p>
        ) : active ? (
          <>
            <p className="text-[13px] text-ink2">{d.deviceOn}</p>
            <span className="self-start rounded-[10px] bg-elev px-3.5 py-3 text-[13px] font-semibold">
              {d.turnedOn}
            </span>
          </>
        ) : (
          <button
            type="button"
            className="min-h-11 self-start rounded-[10px] bg-accent px-3.5 text-[13px] font-semibold text-accent-ink disabled:opacity-50"
            disabled={on.isPending}
            onClick={() => on.mutate()}
          >
            {x.turnOn}
          </button>
        ))}
      {error instanceof PushDenied ? (
        <p role="alert" className="text-sm text-down">
          {x.denied}
        </p>
      ) : error instanceof PushEndpointRefused ? (
        <p role="alert" className="text-sm text-down">
          {x.badEndpoint}
        </p>
      ) : (
        on.isError && <ErrorText message={on.error.message} />
      )}
    </div>
  );
}

function Devices({ state }: { state: PushState }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (dev: PushDeviceRow) => removeDevice(dev, state.thisEndpoint),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['push'] }),
  });
  if (state.devices.length === 0) return null;
  return (
    <div className="flex flex-col">
      <h3 className="sr-only">{x.devices}</h3>
      {state.devices.map((dev) => {
        const name = dev.device || `#${dev.id}`;
        const bad = dev.disabledAt === null && dev.failures > 0;
        return (
          <div
            key={dev.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line py-2.5"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold text-ink">{name}</span>
              <span className="text-xs text-ink3">
                {d.addedLine(when(dev.createdAt), when(dev.lastOkAt))}
              </span>
              <span
                className={`text-xs ${dev.disabledAt !== null ? 'text-ink3' : bad ? 'text-down' : 'text-up'}`}
              >
                {stateText(dev)}
              </span>
            </span>
            <button
              type="button"
              aria-label={x.remove(name)}
              disabled={remove.isPending}
              onClick={() => remove.mutate(dev)}
              className="min-h-11 rounded-lg border border-line-strong bg-transparent px-3.5 text-[13px] text-down disabled:opacity-50"
            >
              {d.remove}
            </button>
          </div>
        );
      })}
      {remove.isError && <ErrorText message={remove.error.message} />}
    </div>
  );
}

function deviceLine(dev: PushDeviceRow): string {
  const name = dev.device || `#${dev.id}`;
  if (dev.disabledAt !== null) return n.stopped(name);
  if (dev.failures > 0) return n.failing(name, dev.lastError ?? '');
  return n.active(name);
}

/** One label and value row with an optional note (the v2 settings rows). */
function Row({
  k,
  v,
  note,
  tone = 'text-ink',
}: {
  k: string;
  v: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-line py-2.5 first:border-t-0">
      <span className="text-sm text-ink2">{k}</span>
      <span className={`text-end text-sm font-semibold ${tone}`}>{v}</span>
      {note && <span className="col-span-2 text-xs text-ink3">{note}</span>}
    </div>
  );
}

/**
 * The Notifications card (Marsad v2 Settings): web push devices with their state, quiet hours and the daily cap
 * (not built yet, said so), and the email digest schedule. Removing a device happens here.
 */
export function NotificationsCard() {
  const q = useQuery({ queryKey: ['push'], queryFn: loadPushState });
  const devices = q.data?.devices ?? [];
  const live = devices.filter((dev) => dev.disabledAt === null);
  return (
    <section aria-labelledby="push" className={cardClass}>
      <h2 id="push" className="text-base font-semibold text-ink">
        {n.title}
      </h2>
      {q.isError && <ErrorText message={q.error.message} />}
      <div className="flex flex-col">
        <Row
          k={n.webPush}
          v={q.data ? n.devices(live.length) : t.loading}
          note={devices.length ? devices.map(deviceLine).join(' \u00B7 ') : n.noDevices}
        />
        {q.data && <Devices state={q.data} />}
        <Row k={n.quietHours} v={n.notYet} tone="text-ink3" note={n.quietNote} />
        <Row k={n.dailyCap} v={n.notYet} tone="text-ink3" note={n.dailyCapNote} />
        <Row k={n.digest} v={n.digestValue} note={n.digestNote} />
      </div>
    </section>
  );
}

/** Push setup (ADR 0031): keys, this device and how to test, in three steps. */
export function PushSetup() {
  const q = useQuery({ queryKey: ['push'], queryFn: loadPushState });
  return (
    <section aria-labelledby="push-setup" className={cardClass}>
      <div className="flex flex-col gap-0.5">
        <h2 id="push-setup" className="text-base font-semibold text-ink">
          {n.setup}
        </h2>
        <span className="text-xs text-ink3">{d.sub}</span>
      </div>
      <p className="text-xs text-ink3">{x.intro}</p>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-2.5">
          <Keys state={q.data} />
          <ThisDevice state={q.data} />
          <div className={stepCard}>
            <StepTitle n={3}>{d.test}</StepTitle>
            <p className="text-[13px] leading-[1.45] text-ink2">{d.testText}</p>
          </div>
        </div>
      )}
    </section>
  );
}
