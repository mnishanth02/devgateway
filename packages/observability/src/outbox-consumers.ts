import { assertNoForbiddenTelemetryFields } from './telemetry-safety.ts';

export type WorkflowOutboxDestinationKind =
  | 'trace'
  | 'audit'
  | 'notification'
  | 'eval_evidence'
  | 'portal_update'
  | 'webhook_ref';

export type WorkflowOutboxDeliveryStatus = 'delivered' | 'duplicate';

export interface WorkflowOutboxConsumerEvent {
  readonly outboxId: string;
  readonly workflowId: string;
  readonly sourceEventRef: string;
  readonly destinationKind: WorkflowOutboxDestinationKind;
  readonly idempotencyKey: string;
  readonly payloadArtifactRef?: string | null;
  readonly traceId?: string;
  readonly requestId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface WorkflowOutboxDeliveryResult {
  readonly status: WorkflowOutboxDeliveryStatus;
  readonly idempotencyKey: string;
}

export type WorkflowOutboxConsumer = (
  event: WorkflowOutboxConsumerEvent,
) => Promise<WorkflowOutboxDeliveryResult> | WorkflowOutboxDeliveryResult;

export interface WorkflowOutboxConsumerSet {
  readonly trace?: WorkflowOutboxConsumer;
  readonly audit?: WorkflowOutboxConsumer;
  readonly notification?: WorkflowOutboxConsumer;
  readonly portalNotification?: WorkflowOutboxConsumer;
  readonly portalUpdate?: WorkflowOutboxConsumer;
  readonly evalEvidence?: WorkflowOutboxConsumer;
  readonly webhookRef?: WorkflowOutboxConsumer;
}

export interface InMemoryWorkflowOutboxSink {
  readonly deliveredEvents: readonly WorkflowOutboxConsumerEvent[];
  readonly deliveredKeys: ReadonlySet<string>;
  consume(event: WorkflowOutboxConsumerEvent): WorkflowOutboxDeliveryResult;
}

export function createInMemoryWorkflowOutboxSink(): InMemoryWorkflowOutboxSink {
  const deliveredEvents: WorkflowOutboxConsumerEvent[] = [];
  const deliveredKeys = new Set<string>();
  return {
    get deliveredEvents() {
      return deliveredEvents;
    },
    get deliveredKeys() {
      return deliveredKeys;
    },
    consume(event) {
      assertNoForbiddenTelemetryFields(event, 'workflow outbox event');
      const key = destinationScopedIdempotencyKey(event);
      if (deliveredKeys.has(key)) {
        return { status: 'duplicate', idempotencyKey: key };
      }
      deliveredKeys.add(key);
      deliveredEvents.push(event);
      return { status: 'delivered', idempotencyKey: key };
    },
  };
}

export function createDefaultInMemoryWorkflowOutboxConsumers(): {
  readonly sinks: {
    readonly trace: InMemoryWorkflowOutboxSink;
    readonly audit: InMemoryWorkflowOutboxSink;
    readonly portalNotification: InMemoryWorkflowOutboxSink;
    readonly evalEvidence: InMemoryWorkflowOutboxSink;
  };
  readonly consumers: WorkflowOutboxConsumerSet;
} {
  const trace = createInMemoryWorkflowOutboxSink();
  const audit = createInMemoryWorkflowOutboxSink();
  const portalNotification = createInMemoryWorkflowOutboxSink();
  const evalEvidence = createInMemoryWorkflowOutboxSink();
  return {
    sinks: { trace, audit, portalNotification, evalEvidence },
    consumers: {
      trace: (event) => trace.consume(event),
      audit: (event) => audit.consume(event),
      notification: (event) => portalNotification.consume(event),
      portalNotification: (event) => portalNotification.consume(event),
      portalUpdate: (event) => portalNotification.consume(event),
      evalEvidence: (event) => evalEvidence.consume(event),
    },
  };
}

export async function consumeWorkflowOutboxEvent(
  event: WorkflowOutboxConsumerEvent,
  consumers: WorkflowOutboxConsumerSet,
): Promise<WorkflowOutboxDeliveryResult> {
  const consumer = consumerForDestination(event.destinationKind, consumers);
  if (consumer === undefined) {
    throw new Error(`No workflow outbox consumer configured for destination ${event.destinationKind}`);
  }
  return consumer(event);
}

export function destinationScopedIdempotencyKey(event: Pick<WorkflowOutboxConsumerEvent, 'destinationKind' | 'sourceEventRef' | 'idempotencyKey'>): string {
  return JSON.stringify([event.destinationKind, event.sourceEventRef, event.idempotencyKey]);
}

function consumerForDestination(
  destination: WorkflowOutboxDestinationKind,
  consumers: WorkflowOutboxConsumerSet,
): WorkflowOutboxConsumer | undefined {
  switch (destination) {
    case 'trace':
      return consumers.trace;
    case 'audit':
      return consumers.audit;
    case 'notification':
      return consumers.notification ?? consumers.portalNotification;
    case 'portal_update':
      return consumers.portalUpdate ?? consumers.portalNotification;
    case 'eval_evidence':
      return consumers.evalEvidence;
    case 'webhook_ref':
      return consumers.webhookRef;
  }
}
