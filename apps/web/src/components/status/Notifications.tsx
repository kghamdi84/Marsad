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
import { panelTitle } from '../study/Panel';
import { t } from '../../strings';

const x = t.status.push;
const td = 'border-b border-line px-2 py-2 align-top';
const th = 'border-b border-line px-2 py-2 text-start font-medium text-muted';

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
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{x.step1}</h3>
      {state.publicKey === null ? (
        <>
          <p className="text-sm text-muted">{x.noKeys}</p>
          <Button
            type="button"
            className="self-start"
            disabled={make.isPending}
            onClick={() => make.mutate()}
          >
            {x.createKeys}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm">{x.keysReady}</p>
          {!confirm ? (
            <Button type="button" className="self-start" onClick={() => setConfirm(true)}>
              {x.replace}
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-sm text-down">
                {x.replaceWarning}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={make.isPending} onClick={() => make.mutate()}>
                  {x.replaceConfirm}
                </Button>
                <Button type="button" onClick={() => setConfirm(false)}>
                  {x.cancel}
                </Button>
              </div>
            </div>
          )}
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
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{x.step2}</h3>
      {support === 'needs-home-screen' && <p className="text-sm">{x.needsHomeScreen}</p>}
      {support === 'unsupported' && <p className="text-sm text-muted">{x.unsupported}</p>}
      {support === 'supported' &&
        (state.publicKey === null ? (
          <p className="text-sm text-muted">{x.needsKeys}</p>
        ) : active ? (
          <p className="text-sm">{x.on}</p>
        ) : (
          <Button
            type="button"
            className="self-start"
            disabled={on.isPending}
            onClick={() => on.mutate()}
          >
            {x.turnOn}
          </Button>
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
    mutationFn: (d: PushDeviceRow) => removeDevice(d, state.thisEndpoint),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['push'] }),
  });
  return (
    <div className="flex flex-col gap-2 overflow-x-auto">
      <h3 className="text-sm font-semibold">{x.devices}</h3>
      {state.devices.length === 0 ? (
        <p className="text-sm text-muted">{x.noDevices}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>{x.colDevice}</th>
              <th className={th}>{x.colAdded}</th>
              <th className={th}>{x.colLastOk}</th>
              <th className={th}>{x.colState}</th>
              <th className={th}>
                <span className="sr-only">{x.remove('')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {state.devices.map((d) => (
              <tr key={d.id}>
                <td className={td}>{d.device || `#${d.id}`}</td>
                <td className={td}>{when(d.createdAt)}</td>
                <td className={td}>{when(d.lastOkAt)}</td>
                <td className={td}>{stateText(d)}</td>
                <td className={td}>
                  <Button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(d)}
                  >
                    {x.remove(d.device || `#${d.id}`)}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {remove.isError && <ErrorText message={remove.error.message} />}
    </div>
  );
}

/** Notification setup on the Status page (ADR 0031): keys, this device, the device list and how to test. */
export function Notifications() {
  const q = useQuery({ queryKey: ['push'], queryFn: loadPushState });
  return (
    <section aria-labelledby="push" className={`${cardClass} gap-3!`}>
      <h2 id="push" className={panelTitle}>
        {x.title}
      </h2>
      <p className="text-sm text-muted">{x.intro}</p>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data && (
        <>
          <Keys state={q.data} />
          <ThisDevice state={q.data} />
          <Devices state={q.data} />
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{x.step3}</h3>
            <p className="text-sm">{x.testSteps}</p>
          </div>
        </>
      )}
    </section>
  );
}
