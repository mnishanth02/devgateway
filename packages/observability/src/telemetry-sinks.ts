export type TelemetrySinkKind = 'audit' | 'cost';

export interface TelemetrySinkStatus {
  readonly available?: boolean;
  readonly productionSafe?: boolean;
}

export class TelemetrySinkUnavailableError extends Error {
  readonly sinkKind: TelemetrySinkKind;

  constructor(sinkKind: TelemetrySinkKind, reason: string) {
    super(`${sinkKind} telemetry sink unavailable: ${reason}`);
    this.name = 'TelemetrySinkUnavailableError';
    this.sinkKind = sinkKind;
  }
}

export function assertProductionTelemetrySink(
  sinkKind: TelemetrySinkKind,
  environment: string,
  sink: TelemetrySinkStatus | undefined,
): void {
  if (environment !== 'production') return;
  if (sink === undefined) {
    throw new TelemetrySinkUnavailableError(sinkKind, 'production requires an explicit sink');
  }
  if (sink.available === false) {
    throw new TelemetrySinkUnavailableError(sinkKind, 'sink reported unavailable');
  }
  if (sink.productionSafe === false) {
    throw new TelemetrySinkUnavailableError(sinkKind, 'non-production sink cannot be used in production');
  }
}
