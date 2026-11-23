/**
 * Vendor timestamps arrive as seconds, milliseconds, microseconds or nanoseconds.
 * Everything inside Marsad is a UTC instant in epoch milliseconds (or a Date).
 *
 * The unit is inferred from the magnitude of the value. That is unambiguous for
 * any date between 2001 and 2286: seconds have 10 digits, milliseconds 13,
 * microseconds 16 and nanoseconds 19.
 */

export type EpochUnit = 's' | 'ms' | 'us' | 'ns';

/** Infers the unit of an epoch value from its magnitude. Throws on values outside 2001 to 2286. */
export function inferEpochUnit(value: number | bigint | string): EpochUnit {
  const digits = integerPart(value).replace('-', '').length;
  switch (digits) {
    case 10:
      return 's';
    case 13:
      return 'ms';
    case 16:
      return 'us';
    case 19:
      return 'ns';
    default:
      throw new RangeError(`Cannot infer the epoch unit of ${String(value)} (${digits} digits)`);
  }
}

function integerPart(value: number | bigint | string): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value.trim())) throw new RangeError(`Not an integer timestamp: ${value}`);
    return value.trim();
  }
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite timestamp: ${value}`);
  // Numbers above 2^53 (nanoseconds) have lost sub-microsecond precision already; BigInt keeps the digits we have.
  return BigInt(Math.trunc(value)).toString();
}

/** Converts any supported epoch value to whole milliseconds since 1970-01-01T00:00:00Z. */
export function toEpochMs(value: number | bigint | string): number {
  const unit = inferEpochUnit(value);
  const big = BigInt(integerPart(value));
  switch (unit) {
    case 's':
      return Number(big * 1000n);
    case 'ms':
      return Number(big);
    case 'us':
      return Number(big / 1000n);
    case 'ns':
      return Number(big / 1_000_000n);
  }
}

export function toDate(value: number | bigint | string): Date {
  return new Date(toEpochMs(value));
}

/** UTC ISO 8601 with milliseconds, the only string form Marsad stores. */
export function toIsoUtc(value: Date | number | bigint | string): string {
  const d = value instanceof Date ? value : toDate(value);
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid date');
  return d.toISOString();
}
