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
const stepCard = 'flex flex-col gap-2.5 rounded-xl bg-bg p-3.5';
const btnOutline =
  'min-h-11 rounded-[10px] border border-muted/40 bg-transparent px-3.5 text-[13px] text-white disabled:opacity-50';
function StepTitle({ n, children }: { n: number; children: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      <span
        aria-hidden="true"
        className="flex size-6 items-center justify-center rounded-full bg-ink text-xs"
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
          <p className="text-[13px] text-muted">{x.noKeys}</p>
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
                  className="min-h-11 px-3.5 text-[13px] text-muted"
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
          <label htmlFor="vapid-private" className="text-sm text-muted">
            {x.privateKey}
          </label>
          <input
            id="vapid-private"
            readOnly
            value={privateKey}
            className="min-h-11 rounded-sm border border-line bg-bg px-3 font-mono text-sm text-fg"
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
        <p className="text-[13px] text-fg">{x.needsHomeScreen}</p>
      )}
      {support === 'unsupported' && <p className="text-[13px] text-muted">{x.unsupported}</p>}
      {support === 'supported' &&
        (state.publicKey === null ? (
          <p className="text-[13px] text-muted">{x.needsKeys}</p>
        ) : active ? (
          <>
            <p className="text-[13px] text-fg">{d.deviceOn}</p>
            <span className="self-start rounded-[10px] bg-raised px-3.5 py-3 text-[13px] font-semibold">
              {d.turnedOn}
            </span>
          </>
        ) : (
          <button
            type="button"
            className="min-h-11 self-start rounded-[10px] bg-white px-3.5 text-[13px] font-semibold text-raised disabled:opacity-50"
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
  return (
    <div className="flex flex-col">
      <h3 className="sr-only">{x.devices}</h3>
      {state.devices.length === 0 && <p className="text-sm text-muted">{x.noDevices}</p>}
      {state.devices.map((dev) => {
        const name = dev.device || `#${dev.id}`;
        const bad = dev.disabledAt === null && dev.failures > 0;
        return (
          <div
            key={dev.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-line-soft py-3"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{name}</span>
              <span className="text-xs text-muted">
                {d.addedLine(when(dev.createdAt), when(dev.lastOkAt))}
              </span>
              <span
                className={`text-xs ${dev.disabledAt !== null ? 'text-muted' : bad ? 'text-down' : 'text-up'}`}
              >
                {stateText(dev)}
              </span>
            </span>
            <button
              type="button"
              aria-label={x.remove(name)}
              disabled={remove.isPending}
              onClick={() => remove.mutate(dev)}
              className="min-h-11 rounded-[10px] border border-down/50 bg-transparent px-3.5 text-[13px] text-down disabled:opacity-50"
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

/** Notification setup on the Status page (ADR 0031): keys, this device, the device list and how to test. */
export function Notifications() {
  const q = useQuery({ queryKey: ['push'], queryFn: loadPushState });
  return (
    <section aria-labelledby="push" className={`${cardClass} gap-4! p-5!`}>
      <div className="flex flex-col gap-0.5">
        <h2 id="push" className="text-[17px] font-semibold text-white">
          {x.title}
        </h2>
        <span className="text-xs text-muted">{d.sub}</span>
      </div>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-2.5">
            <Keys state={q.data} />
            <ThisDevice state={q.data} />
            <div className={stepCard}>
              <StepTitle n={3}>{d.test}</StepTitle>
              <p className="text-[13px] leading-[1.45] text-fg">{d.testText}</p>
            </div>
          </div>
          <Devices state={q.data} />
        </>
      )}
    </section>
  );
}
