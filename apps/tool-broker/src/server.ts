import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    adapterRegistry,
    executeToolCall,
    sanitizeToolMetadata,
    tool_integrationsPackage,
    type ArtifactRef,
    type ReadOnlyAdapterRegistry,
    type ReadOnlyToolDefinition,
    type SanitizedToolMetadata,
    type ToolCallError,
    type ToolCallRequest,
    type ToolCallResult,
    type ToolPolicyContext,
} from '../../../workers/tool-integrations/src/index.ts';

export interface HealthPayloadOptions {
    readonly port: number;
}

export interface HealthPayload {
    readonly service: '@devgateway/tool-broker';
    readonly status: 'ok';
    readonly port: number;
}

export type BrokerErrorCode =
    | 'INVALID_REQUEST'
    | 'MALFORMED_ARGS'
    | 'METHOD_NOT_ALLOWED'
    | 'POLICY_DENIED'
    | 'REGISTRY_UNAVAILABLE'
    | 'UNSUPPORTED_METHOD'
    | 'UNKNOWN_TOOL'
    | 'WRITE_TOOL_DENIED';

export interface BrokerTypedError {
    readonly code: BrokerErrorCode | ToolCallError['code'];
    readonly message: string;
    readonly retryable: false;
    readonly field?: string;
    readonly tool_id?: string;
    readonly trace_id?: string;
    readonly request_id?: string;
}

export interface BrokerPolicyContext extends ToolPolicyContext {
    readonly requestId: string;
    readonly role?: string;
    readonly projectId?: string;
    readonly dataClass?: string;
    readonly traceId: string;
    readonly approvalArtifactRefs: readonly string[];
    readonly approvalBypassClaimPath?: string;
    readonly contextPresent: boolean;
}

export interface BrokerServerOptions {
    readonly port?: number;
    readonly registry?: ReadOnlyAdapterRegistry;
    readonly policyVersion?: string;
    readonly registryVersion?: string;
    readonly maxBodyBytes?: number;
}

export interface PublicToolDefinition {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly effect: 'read';
    readonly readOnly: true;
    readonly externalNetworkAccess: false;
    readonly outputContainsRawContent: false;
    readonly argsSchema: ReadOnlyToolDefinition['argsSchema'];
    readonly resultShape: string;
}

export interface ToolDiscoveryResponse {
    readonly service: '@devgateway/tool-broker';
    readonly policy_version: string;
    readonly registry_version: string;
    readonly tools: readonly PublicToolDefinition[];
    readonly visible_tool_count: number;
}

export type ToolCallDecision = 'allow' | 'deny';
export type ToolCallStatus = 'succeeded' | 'failed' | 'denied';

export interface AuditArtifactRef {
    readonly kind: string;
    readonly namespace: string;
    readonly artifactId: string;
    readonly opaqueRef?: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
    readonly createdAt: string;
    readonly metadata: SanitizedToolMetadata;
}

export interface ToolCallAuditRecord {
    readonly tool_call_id: string;
    readonly tool_id?: string;
    readonly decision: ToolCallDecision;
    readonly status: ToolCallStatus;
    readonly trace_id: string;
    readonly request_id: string;
    readonly policy_version: string;
    readonly registry_version: string;
    readonly artifact_refs: readonly AuditArtifactRef[];
    readonly approval_artifact_refs: readonly string[];
    readonly result_metadata: SanitizedToolMetadata;
    readonly denial_reason?: string;
    readonly created_at: string;
}

export interface BrokerToolCallResponse {
    readonly ok: boolean;
    readonly statusCode: number;
    readonly body: unknown;
    readonly auditRecord: ToolCallAuditRecord;
}

interface RequestEnvelope {
    readonly method: string;
    readonly url: URL;
    readonly headers: IncomingHttpHeaders;
}

interface ToolCallInput {
    readonly toolId?: unknown;
    readonly args?: unknown;
    readonly rawInput: unknown;
}

interface PolicyDecision {
    readonly allowed: boolean;
    readonly error?: BrokerTypedError;
    readonly denialReason?: string;
}

type JsonRpcId = string | number | null;

const SERVICE_NAME = '@devgateway/tool-broker' as const;
const DEFAULT_POLICY_VERSION = 'tool-broker-readonly-policy.v1';
const DEFAULT_REGISTRY_VERSION = `${tool_integrationsPackage.name}:${tool_integrationsPackage.status}`;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const MAX_AUDIT_RECORDS = 500;
const SAFE_TOOL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,120}$/u;
const SAFE_CONTEXT_VALUE_PATTERN = /^[a-z0-9][a-z0-9._:@/-]{0,127}$/iu;
const READ_ROLES = new Set(['admin', 'auditor', 'developer', 'operator', 'reader', 'service', 'viewer']);
const ALLOWED_DATA_CLASSES = new Set(['approved', 'artifact', 'confidential', 'internal', 'metadata', 'project', 'public']);
const DENIED_DATA_CLASSES = new Set(['credential', 'credentials', 'raw', 'restricted', 'secret', 'secrets', 'token', 'tokens']);
const WRITE_TOOL_ID_PATTERN = /(^|[._-])(add|append|approve|assign|cancel|commit|create|delete|deploy|disable|drop|enable|grant|import|insert|merge|modify|move|mutate|patch|post|publish|put|remove|rename|replace|reset|restore|revoke|rotate|send|set|side[_-]?effect|submit|update|upload|upsert|write)([._-]|$)/u;
const APPROVAL_BYPASS_KEYS = new Set([
    'approval',
    'approvalbypass',
    'approvalclaim',
    'approvalclaims',
    'approvalid',
    'approvals',
    'approved',
    'approvedby',
    'bypassapproval',
    'modelapproval',
    'modelapprovalclaim',
]);

const toolCallAuditRecords: ToolCallAuditRecord[] = [];

class BrokerHttpError extends Error {
    readonly code: BrokerErrorCode;
    readonly statusCode: number;

    constructor(code: BrokerErrorCode, statusCode: number, message: string) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }
}

export function buildHealthPayload(options: HealthPayloadOptions): HealthPayload {
    return {
        service: SERVICE_NAME,
        status: 'ok',
        port: options.port,
    };
}

export function createRequestHandler(portOrOptions: number | BrokerServerOptions = {}) {
    const options = normalizeServerOptions(portOrOptions);
    return (request: IncomingMessage, response: ServerResponse) => {
        void handleHttpRequest(request, response, options).catch((error: unknown) => {
            const requestId = readHeader(request.headers, 'x-request-id') ?? randomUUID();
            const traceId = readHeader(request.headers, 'x-trace-id') ?? requestId;
            const statusCode = error instanceof BrokerHttpError ? error.statusCode : 500;
            const code = error instanceof BrokerHttpError ? error.code : 'INVALID_REQUEST';
            writeJson(response, statusCode, {
                error: typedError(code, error instanceof Error ? error.message : 'Unexpected tool broker error.', {
                    requestId,
                    traceId,
                }),
            });
        });
    };
}

export function startServer(portOrOptions: number | BrokerServerOptions = parsePort(process.env.PORT, 43102)) {
    const options = normalizeServerOptions(portOrOptions);
    const port = options.port;
    const server = createServer(createRequestHandler(options));
    server.listen(port, '127.0.0.1', () => {
        console.log(`${SERVICE_NAME} listening at http://127.0.0.1:${port}`);
    });
    return server;
}

export function listVisibleTools(
    context: BrokerPolicyContext,
    registry: ReadOnlyAdapterRegistry = adapterRegistry,
): readonly PublicToolDefinition[] {
    return registry.definitions
        .filter(isReadOnlyDefinition)
        .filter((definition) => isToolVisibleForContext(definition, context))
        .map(toPublicToolDefinition);
}

export function buildToolDiscoveryResponse(
    context: BrokerPolicyContext,
    options: Required<BrokerServerOptions>,
): ToolDiscoveryResponse {
    const tools = listVisibleTools(context, options.registry);
    return {
        service: SERVICE_NAME,
        policy_version: options.policyVersion,
        registry_version: options.registryVersion,
        tools,
        visible_tool_count: tools.length,
    };
}

export async function executeBrokerToolCall(
    input: ToolCallInput,
    request: RequestEnvelope,
    options: Required<BrokerServerOptions>,
): Promise<BrokerToolCallResponse> {
    const policyContext = buildPolicyContext(request, input.rawInput, true);
    const toolCallId = randomUUID();
    const toolIdResult = normalizeToolId(input.toolId);
    const args = input.args ?? {};

    if (!toolIdResult.ok) {
        return deniedToolCall({
            error: typedError('MALFORMED_ARGS', 'toolId must be a safe tool identifier.', {
                field: 'toolId',
                requestId: policyContext.requestId,
                traceId: policyContext.traceId,
            }),
            denialReason: 'malformed-tool-id',
            options,
            policyContext,
            statusCode: 400,
            toolCallId,
        });
    }

    const toolId = toolIdResult.value;
    if (!isRecord(args)) {
        return deniedToolCall({
            error: typedError('MALFORMED_ARGS', 'Tool arguments must be an object.', {
                field: 'args',
                requestId: policyContext.requestId,
                toolId,
                traceId: policyContext.traceId,
            }),
            denialReason: 'malformed-args',
            options,
            policyContext,
            statusCode: 400,
            toolCallId,
            toolId,
        });
    }

    const policyDecision = evaluateToolCallPolicy({ toolId, args }, policyContext, options.registry);
    if (!policyDecision.allowed) {
        return deniedToolCall({
            error: policyDecision.error ?? typedError('POLICY_DENIED', 'Tool call denied by policy.', {
                requestId: policyContext.requestId,
                toolId,
                traceId: policyContext.traceId,
            }),
            denialReason: policyDecision.denialReason ?? 'policy-denied',
            options,
            policyContext,
            statusCode: policyDecision.error?.code === 'UNKNOWN_TOOL' ? 404 : 403,
            toolCallId,
            toolId,
        });
    }

    const result = await executeToolCall(
        { toolId, args },
        toToolPolicyContext(policyContext),
        options.registry,
    );
    return finalizeToolCallResult(result, toolCallId, policyContext, options);
}

export function evaluateToolCallPolicy(
    request: ToolCallRequest,
    context: BrokerPolicyContext,
    registry: ReadOnlyAdapterRegistry = adapterRegistry,
): PolicyDecision {
    if (!context.contextPresent || !context.actorId || !context.projectId || !context.dataClass) {
        return denyPolicy('POLICY_DENIED', 'Tool call requires actor, project, and data_class policy context.', 'missing-policy-context', request, context);
    }
    if (context.approvalBypassClaimPath) {
        return denyPolicy(
            'POLICY_DENIED',
            'Model-supplied approval claims are not trusted by the read-only tool broker.',
            `approval-bypass-claim:${context.approvalBypassClaimPath}`,
            request,
            context,
        );
    }
    if (!SAFE_CONTEXT_VALUE_PATTERN.test(context.actorId)) {
        return denyPolicy('POLICY_DENIED', 'actorId is not a safe policy context identifier.', 'invalid-actor', request, context);
    }
    if (!SAFE_CONTEXT_VALUE_PATTERN.test(context.projectId)) {
        return denyPolicy('POLICY_DENIED', 'projectId is not a safe policy context identifier.', 'invalid-project', request, context);
    }
    if (context.role && !READ_ROLES.has(context.role.toLowerCase())) {
        return denyPolicy('POLICY_DENIED', `Role '${context.role}' is not allowed to invoke read-only tools.`, 'role-denied', request, context);
    }
    if (DENIED_DATA_CLASSES.has(context.dataClass.toLowerCase())) {
        return denyPolicy('POLICY_DENIED', `Data class '${context.dataClass}' is not allowed for brokered tool reads.`, 'data-class-denied', request, context);
    }
    if (!isRecognizedDataClass(context.dataClass)) {
        return denyPolicy('POLICY_DENIED', `Data class '${context.dataClass}' is not recognized by the broker policy.`, 'data-class-unknown', request, context);
    }
    if (registry.deniedToolIds.has(request.toolId) || isWriteLikeToolId(request.toolId)) {
        return denyPolicy('WRITE_TOOL_DENIED', `Tool '${request.toolId}' is denied before adapter execution.`, 'write-tool-denied', request, context);
    }

    const definition = registry.getDefinition(request.toolId);
    if (!definition) {
        return denyPolicy('UNKNOWN_TOOL', `Unknown read-only tool '${request.toolId}'.`, 'unknown-tool', request, context);
    }
    if (!isReadOnlyDefinition(definition)) {
        return denyPolicy('WRITE_TOOL_DENIED', `Tool '${request.toolId}' is not a read-only tool definition.`, 'not-read-only', request, context);
    }
    if (context.allowedToolIds !== undefined && !context.allowedToolIds.includes(request.toolId)) {
        return denyPolicy('POLICY_DENIED', `Tool '${request.toolId}' is not allowed by caller policy context.`, 'tool-not-allowed', request, context);
    }
    if (!isToolAllowedForDataClass(request.toolId, context.dataClass)) {
        return denyPolicy('POLICY_DENIED', `Tool '${request.toolId}' is not visible for data class '${context.dataClass}'.`, 'tool-data-class-denied', request, context);
    }

    return { allowed: true };
}

export function getToolCallAuditRecords(): readonly ToolCallAuditRecord[] {
    return Object.freeze([...toolCallAuditRecords]);
}

export function resetToolCallAuditRecords(): void {
    toolCallAuditRecords.splice(0, toolCallAuditRecords.length);
}

export function buildPolicyContext(
    request: RequestEnvelope,
    rawInput: unknown = {},
    requireContext = false,
): BrokerPolicyContext {
    const policySource = requireContext ? {} : extractPolicySource(rawInput);
    const query = requireContext ? new URLSearchParams() : request.url.searchParams;
    const requestId = firstString([
        readHeader(request.headers, 'x-request-id'),
        getString(policySource, 'requestId'),
        getString(policySource, 'request_id'),
        query.get('request_id'),
    ]) ?? randomUUID();
    const traceId = firstString([
        readHeader(request.headers, 'x-trace-id'),
        getString(policySource, 'traceId'),
        getString(policySource, 'trace_id'),
        query.get('trace_id'),
        requestId,
    ]) ?? requestId;
    const actorId = firstString([
        readHeader(request.headers, 'x-devgateway-actor-id'),
        readHeader(request.headers, 'x-actor-id'),
        readHeader(request.headers, 'x-user-id'),
        getString(policySource, 'actorId'),
        getString(policySource, 'actor_id'),
        query.get('actor_id'),
    ]);
    const projectId = firstString([
        readHeader(request.headers, 'x-devgateway-project-id'),
        readHeader(request.headers, 'x-project-id'),
        getString(policySource, 'projectId'),
        getString(policySource, 'project_id'),
        query.get('project_id'),
    ]);
    const dataClass = firstString([
        readHeader(request.headers, 'x-devgateway-data-class'),
        readHeader(request.headers, 'x-data-class'),
        getString(policySource, 'dataClass'),
        getString(policySource, 'data_class'),
        query.get('data_class'),
    ]);
    const role = firstString([
        readHeader(request.headers, 'x-devgateway-role'),
        readHeader(request.headers, 'x-role'),
        getString(policySource, 'role'),
        query.get('role'),
    ]);
    const allowedToolIds = stringList([
        readHeader(request.headers, 'x-devgateway-allowed-tools'),
        getUnknown(policySource, 'allowedToolIds'),
        getUnknown(policySource, 'allowed_tool_ids'),
        query.get('allowed_tools'),
    ]).filter((toolId) => SAFE_TOOL_ID_PATTERN.test(toolId));
    const approvedDocumentCollections = stringList([
        readHeader(request.headers, 'x-devgateway-approved-doc-collections'),
        getUnknown(policySource, 'approvedDocumentCollections'),
        getUnknown(policySource, 'approved_document_collections'),
        query.get('approved_document_collections'),
    ]).filter(isApprovedDocumentationCollection);
    const allowedArtifactNamespaces = stringList([
        readHeader(request.headers, 'x-devgateway-allowed-artifact-namespaces'),
        getUnknown(policySource, 'allowedArtifactNamespaces'),
        getUnknown(policySource, 'allowed_artifact_namespaces'),
        query.get('allowed_artifact_namespaces'),
    ]).filter((namespace) => SAFE_CONTEXT_VALUE_PATTERN.test(namespace));
    const approvalArtifactRefs = stringList([
        readHeader(request.headers, 'x-devgateway-trusted-approval-artifacts'),
        readHeader(request.headers, 'x-devgateway-approval-artifacts'),
    ]).filter((artifactRef) => artifactRef.startsWith('opaque://'));
    const maxResultItems = optionalPositiveInteger(
        firstUnknown([
            readHeader(request.headers, 'x-devgateway-max-result-items'),
            getUnknown(policySource, 'maxResultItems'),
            getUnknown(policySource, 'max_result_items'),
            query.get('max_result_items'),
        ]),
    );
    const approvalBypassClaimPath = findApprovalBypassClaim(rawInput);
    const contextPresent = Boolean(actorId && projectId && dataClass) || (!requireContext && (actorId !== undefined || projectId !== undefined || dataClass !== undefined));

    return {
        requestId,
        traceId,
        approvalArtifactRefs: Object.freeze(approvalArtifactRefs),
        contextPresent,
        ...(actorId === undefined ? {} : { actorId }),
        ...(projectId === undefined ? {} : { projectId }),
        ...(dataClass === undefined ? {} : { dataClass }),
        ...(role === undefined ? {} : { role }),
        ...(allowedToolIds.length === 0 ? {} : { allowedToolIds: Object.freeze(allowedToolIds) }),
        ...(approvedDocumentCollections.length === 0 ? {} : { approvedDocumentCollections: Object.freeze(approvedDocumentCollections) }),
        ...(allowedArtifactNamespaces.length === 0 ? {} : { allowedArtifactNamespaces: Object.freeze(allowedArtifactNamespaces) }),
        ...(maxResultItems === undefined ? {} : { maxResultItems }),
        ...(approvalBypassClaimPath === undefined ? {} : { approvalBypassClaimPath }),
    };
}

async function handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
    options: Required<BrokerServerOptions>,
): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const envelope: RequestEnvelope = { method: request.method ?? 'GET', url, headers: request.headers };
    const path = url.pathname;

    if (path === '/healthz' || path === '/readyz') {
        if (envelope.method !== 'GET') {
            writeJson(response, 405, { error: typedError('METHOD_NOT_ALLOWED', `${path} only supports GET.`) });
            return;
        }
        writeJson(response, 200, buildHealthPayload({ port: options.port }));
        return;
    }

    if (path === '/api/tools') {
        if (envelope.method !== 'GET') {
            writeJson(response, 405, { error: typedError('METHOD_NOT_ALLOWED', '/api/tools only supports GET.') });
            return;
        }
        writeJson(response, 200, buildToolDiscoveryResponse(buildPolicyContext(envelope), options));
        return;
    }

    if (path === '/api/tools/call') {
        if (envelope.method !== 'POST') {
            writeJson(response, 405, { error: typedError('METHOD_NOT_ALLOWED', '/api/tools/call only supports POST.') });
            return;
        }
        const body = await readJsonBody(request, options.maxBodyBytes);
        const callInput = toToolCallInput(body);
        const result = await executeBrokerToolCall(callInput, envelope, options);
        writeJson(response, result.statusCode, result.body);
        return;
    }

    if (path === '/mcp/sse') {
        if (envelope.method !== 'GET') {
            writeJson(response, 405, { error: typedError('METHOD_NOT_ALLOWED', '/mcp/sse only supports GET.') });
            return;
        }
        writeSseReady(response);
        return;
    }

    if (path === '/mcp' || path === '/mcp/messages') {
        if (envelope.method !== 'POST') {
            writeJson(response, 405, { error: typedError('METHOD_NOT_ALLOWED', `${path} only supports POST.`) });
            return;
        }
        const body = await readJsonBody(request, options.maxBodyBytes);
        const result = await handleMcpJsonRpc(body, envelope, options);
        writeJson(response, result.statusCode, result.body);
        return;
    }

    writeJson(response, 404, {
        error: typedError('UNKNOWN_TOOL', 'DevGateway Tool Broker route not found.'),
    });
}

export async function handleMcpJsonRpc(
    body: unknown,
    request: RequestEnvelope,
    options: Required<BrokerServerOptions>,
): Promise<{ readonly statusCode: number; readonly body: unknown }> {
    if (Array.isArray(body)) {
        if (body.length === 0) {
            return { statusCode: 400, body: jsonRpcError(null, -32600, 'JSON-RPC batch must not be empty.', { code: 'INVALID_REQUEST' }) };
        }
        const responses: Record<string, unknown>[] = [];
        for (const item of body) {
            responses.push(await handleSingleMcpRequest(item, request, options));
        }
        return { statusCode: responses.some((item) => 'error' in item) ? 400 : 200, body: responses };
    }
    const response = await handleSingleMcpRequest(body, request, options);
    return { statusCode: 'error' in response ? 400 : 200, body: response };
}

async function handleSingleMcpRequest(
    body: unknown,
    request: RequestEnvelope,
    options: Required<BrokerServerOptions>,
): Promise<Record<string, unknown>> {
    if (!isRecord(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
        return jsonRpcError(readJsonRpcId(body), -32600, 'Invalid JSON-RPC request.', { code: 'INVALID_REQUEST' });
    }

    const id = readJsonRpcId(body);
    if (body.method === 'tools/list') {
        const context = buildPolicyContext(request, body);
        return {
            jsonrpc: '2.0',
            id,
            result: {
                tools: listVisibleTools(context, options.registry).map(toMcpToolDefinition),
            },
        };
    }

    if (body.method === 'tools/call') {
        const params = isRecord(body.params) ? body.params : {};
        const callInput: ToolCallInput = {
            toolId: params.name ?? params.toolId ?? params.tool_id,
            args: params.arguments ?? params.args ?? {},
            rawInput: body,
        };
        const call = await executeBrokerToolCall(callInput, request, options);
        if (!call.ok) {
            const errorBody = isRecord(call.body) && isRecord(call.body.error) ? call.body.error : {};
            return jsonRpcError(
                id,
                toJsonRpcErrorCode(getString(errorBody, 'code')),
                getString(errorBody, 'message') ?? 'Tool call failed.',
                {
                    code: getString(errorBody, 'code') ?? 'POLICY_DENIED',
                    tool_call_id: call.auditRecord.tool_call_id,
                    tool_id: call.auditRecord.tool_id,
                    trace_id: call.auditRecord.trace_id,
                    request_id: call.auditRecord.request_id,
                },
            );
        }
        return {
            jsonrpc: '2.0',
            id,
            result: toMcpToolCallResult(call.body),
        };
    }

    return jsonRpcError(id, -32601, `Unsupported MCP method '${body.method}'.`, {
        code: 'UNSUPPORTED_METHOD',
        method: body.method,
    });
}

function normalizeServerOptions(portOrOptions: number | BrokerServerOptions): Required<BrokerServerOptions> {
    const options = typeof portOrOptions === 'number' ? { port: portOrOptions } : portOrOptions;
    return {
        port: options.port ?? parsePort(process.env.PORT, 43102),
        registry: options.registry ?? adapterRegistry,
        policyVersion: options.policyVersion ?? DEFAULT_POLICY_VERSION,
        registryVersion: options.registryVersion ?? DEFAULT_REGISTRY_VERSION,
        maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    };
}

function toToolCallInput(body: unknown): ToolCallInput {
    if (!isRecord(body)) {
        return { toolId: undefined, args: undefined, rawInput: body };
    }
    return {
        toolId: body.toolId ?? body.tool_id ?? body.name,
        args: body.args ?? body.arguments ?? {},
        rawInput: body,
    };
}

function finalizeToolCallResult(
    result: ToolCallResult,
    toolCallId: string,
    policyContext: BrokerPolicyContext,
    options: Required<BrokerServerOptions>,
): BrokerToolCallResponse {
    if (result.ok) {
        const sanitizedArtifacts = (result.artifacts ?? []).map(toAuditArtifactRef);
        const sanitizedMetadata = sanitizeToolMetadata(result.metadata ?? {});
        const auditRecord = createAuditRecord({
            toolCallId,
            toolId: result.toolId,
            decision: 'allow',
            status: 'succeeded',
            policyContext,
            options,
            artifacts: result.artifacts,
            resultMetadata: result.metadata,
        });
        appendAuditRecord(auditRecord);
        return {
            ok: true,
            statusCode: 200,
            auditRecord,
            body: {
                ok: true,
                tool_call_id: auditRecord.tool_call_id,
                tool_id: result.toolId,
                trace_id: auditRecord.trace_id,
                request_id: auditRecord.request_id,
                result: result.data,
                artifacts: sanitizedArtifacts,
                metadata: sanitizedMetadata,
            },
        };
    }

    const denied = isDenyError(result.error.code);
    const auditRecord = createAuditRecord({
        toolCallId,
        decision: denied ? 'deny' : 'allow',
        status: denied ? 'denied' : 'failed',
        policyContext,
        options,
        resultMetadata: result.metadata,
        ...(result.toolId === undefined ? {} : { toolId: result.toolId }),
        ...(denied ? { denialReason: result.error.code } : {}),
    });
    appendAuditRecord(auditRecord);
    return {
        ok: false,
        statusCode: statusCodeForToolError(result.error.code),
        auditRecord,
        body: {
            ok: false,
            tool_call_id: auditRecord.tool_call_id,
            trace_id: auditRecord.trace_id,
            request_id: auditRecord.request_id,
            error: toBrokerError(result.error, policyContext),
        },
    };
}

function deniedToolCall(options: {
    readonly toolCallId: string;
    readonly toolId?: string;
    readonly error: BrokerTypedError;
    readonly denialReason: string;
    readonly policyContext: BrokerPolicyContext;
    readonly options: Required<BrokerServerOptions>;
    readonly statusCode: number;
}): BrokerToolCallResponse {
    const auditRecord = createAuditRecord({
        toolCallId: options.toolCallId,
        decision: 'deny',
        status: 'denied',
        policyContext: options.policyContext,
        options: options.options,
        denialReason: options.denialReason,
        ...(options.toolId === undefined ? {} : { toolId: options.toolId }),
    });
    appendAuditRecord(auditRecord);
    return {
        ok: false,
        statusCode: options.statusCode,
        auditRecord,
        body: {
            ok: false,
            tool_call_id: auditRecord.tool_call_id,
            trace_id: auditRecord.trace_id,
            request_id: auditRecord.request_id,
            error: options.error,
        },
    };
}

function createAuditRecord(input: {
    readonly toolCallId: string;
    readonly toolId?: string;
    readonly decision: ToolCallDecision;
    readonly status: ToolCallStatus;
    readonly policyContext: BrokerPolicyContext;
    readonly options: Required<BrokerServerOptions>;
    readonly artifacts?: readonly ArtifactRef[];
    readonly resultMetadata?: SanitizedToolMetadata;
    readonly denialReason?: string;
}): ToolCallAuditRecord {
    return {
        tool_call_id: input.toolCallId,
        decision: input.decision,
        status: input.status,
        trace_id: input.policyContext.traceId ?? input.policyContext.requestId ?? input.toolCallId,
        request_id: input.policyContext.requestId ?? input.toolCallId,
        policy_version: input.options.policyVersion,
        registry_version: input.options.registryVersion,
        artifact_refs: Object.freeze((input.artifacts ?? []).map(toAuditArtifactRef)),
        approval_artifact_refs: Object.freeze([...input.policyContext.approvalArtifactRefs]),
        result_metadata: sanitizeToolMetadata(input.resultMetadata ?? {}),
        created_at: new Date().toISOString(),
        ...(input.toolId === undefined ? {} : { tool_id: input.toolId }),
        ...(input.denialReason === undefined ? {} : { denial_reason: sanitizeSummary(input.denialReason) }),
    };
}

function appendAuditRecord(record: ToolCallAuditRecord): void {
    toolCallAuditRecords.push(Object.freeze(record));
    if (toolCallAuditRecords.length > MAX_AUDIT_RECORDS) {
        toolCallAuditRecords.splice(0, toolCallAuditRecords.length - MAX_AUDIT_RECORDS);
    }
}

function toAuditArtifactRef(artifact: ArtifactRef): AuditArtifactRef {
    return {
        kind: artifact.kind,
        namespace: artifact.namespace,
        artifactId: artifact.artifactId,
        mediaType: artifact.mediaType,
        sizeBytes: artifact.sizeBytes,
        createdAt: artifact.createdAt,
        metadata: sanitizeToolMetadata(artifact.metadata),
        ...(artifact.opaqueRef.startsWith('opaque://') ? { opaqueRef: artifact.opaqueRef } : {}),
    };
}

function denyPolicy(
    code: BrokerTypedError['code'],
    message: string,
    denialReason: string,
    request: ToolCallRequest,
    context: BrokerPolicyContext,
): PolicyDecision {
    return {
        allowed: false,
        denialReason,
        error: typedError(code, message, {
            requestId: context.requestId,
            toolId: request.toolId,
            traceId: context.traceId,
        }),
    };
}

function toToolPolicyContext(context: BrokerPolicyContext): ToolPolicyContext {
    return {
        ...(context.actorId === undefined ? {} : { actorId: context.actorId }),
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
        ...(context.allowedToolIds === undefined ? {} : { allowedToolIds: context.allowedToolIds }),
        ...(context.approvedDocumentCollections === undefined ? {} : { approvedDocumentCollections: context.approvedDocumentCollections }),
        ...(context.allowedArtifactNamespaces === undefined ? {} : { allowedArtifactNamespaces: context.allowedArtifactNamespaces }),
        ...(context.maxResultItems === undefined ? {} : { maxResultItems: context.maxResultItems }),
    };
}

function toPublicToolDefinition(definition: ReadOnlyToolDefinition): PublicToolDefinition {
    return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        effect: 'read',
        readOnly: true,
        externalNetworkAccess: false,
        outputContainsRawContent: false,
        argsSchema: definition.argsSchema,
        resultShape: definition.resultShape,
    };
}

function toMcpToolDefinition(definition: PublicToolDefinition): Record<string, unknown> {
    return {
        name: definition.id,
        title: definition.name,
        description: definition.description,
        inputSchema: definition.argsSchema,
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    };
}

function toMcpToolCallResult(body: unknown): Record<string, unknown> {
    const resultBody = isRecord(body) ? body : {};
    const result = resultBody.result;
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(result ?? null),
            },
        ],
        structuredContent: result ?? null,
        isError: false,
        tool_call_id: resultBody.tool_call_id,
        trace_id: resultBody.trace_id,
        request_id: resultBody.request_id,
        metadata: resultBody.metadata ?? {},
        artifacts: resultBody.artifacts ?? [],
    };
}

function isReadOnlyDefinition(definition: ReadOnlyToolDefinition): boolean {
    return (
        definition.readOnly === true &&
        definition.effect === 'read' &&
        definition.externalNetworkAccess === false &&
        definition.outputContainsRawContent === false
    );
}

function isToolVisibleForContext(definition: ReadOnlyToolDefinition, context: BrokerPolicyContext): boolean {
    if (!isReadOnlyDefinition(definition)) return false;
    if (context.allowedToolIds !== undefined && !context.allowedToolIds.includes(definition.id)) return false;
    if (context.dataClass !== undefined && !isRecognizedDataClass(context.dataClass)) return false;
    if (context.dataClass !== undefined && !isToolAllowedForDataClass(definition.id, context.dataClass)) return false;
    if (context.role !== undefined && !READ_ROLES.has(context.role.toLowerCase())) return false;
    return true;
}

function isRecognizedDataClass(dataClass: string): boolean {
    const normalized = dataClass.toLowerCase();
    return ALLOWED_DATA_CLASSES.has(normalized) && !DENIED_DATA_CLASSES.has(normalized);
}

function isWriteLikeToolId(toolId: string): boolean {
    return WRITE_TOOL_ID_PATTERN.test(toolId);
}

function isToolAllowedForDataClass(toolId: string, dataClass: string): boolean {
    const normalized = dataClass.toLowerCase();
    if (DENIED_DATA_CLASSES.has(normalized)) return false;
    if (normalized === 'public') {
        return toolId === 'repository.metadata.read' || toolId === 'documentation.lookup.approved';
    }
    if (normalized === 'metadata') {
        return toolId === 'repository.metadata.read';
    }
    if (normalized === 'approved') {
        return toolId === 'repository.metadata.read' || toolId === 'documentation.lookup.approved';
    }
    if (normalized === 'artifact') {
        return toolId === 'repository.metadata.read' || toolId.startsWith('eval.artifact.');
    }
    return true;
}

function normalizeToolId(toolId: unknown): { readonly ok: true; readonly value: string } | { readonly ok: false } {
    if (typeof toolId !== 'string' || !SAFE_TOOL_ID_PATTERN.test(toolId)) {
        return { ok: false };
    }
    return { ok: true, value: toolId };
}

function extractPolicySource(rawInput: unknown): Record<string, unknown> {
    if (!isRecord(rawInput)) return {};
    const params = isRecord(rawInput.params) ? rawInput.params : undefined;
    const candidates = [
        rawInput.policyContext,
        rawInput.policy_context,
        rawInput.context,
        params?.policyContext,
        params?.policy_context,
        params?.context,
        params,
        rawInput,
    ];
    for (const candidate of candidates) {
        if (isRecord(candidate)) return candidate;
    }
    return {};
}

function findApprovalBypassClaim(value: unknown, path = '$'): string | undefined {
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            const match = findApprovalBypassClaim(value[index], `${path}[${index}]`);
            if (match) return match;
        }
        return undefined;
    }
    if (typeof value === 'string') {
        return findApprovalBypassClaimInJsonString(value, path);
    }
    if (!isRecord(value)) return undefined;
    for (const [key, nested] of Object.entries(value)) {
        if (APPROVAL_BYPASS_KEYS.has(normalizeKey(key))) {
            return `${path}.${key}`;
        }
        const match = findApprovalBypassClaim(nested, `${path}.${key}`);
        if (match) return match;
    }
    return undefined;
}

function findApprovalBypassClaimInJsonString(value: string, path: string): string | undefined {
    const trimmed = value.trim();
    if (!isJsonLikeString(trimmed)) return undefined;
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed === value) return undefined;
        return findApprovalBypassClaim(parsed, `${path}<json>`);
    } catch {
        return undefined;
    }
}

function isJsonLikeString(value: string): boolean {
    if (value.length < 2) return false;
    return (value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'));
}

function normalizeKey(key: string): string {
    return key.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function isApprovedDocumentationCollection(value: string): value is 'architecture' | 'operations' | 'policy' {
    return value === 'architecture' || value === 'operations' || value === 'policy';
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > maxBodyBytes) {
            throw new BrokerHttpError('INVALID_REQUEST', 413, `Request body exceeds ${maxBodyBytes} bytes.`);
        }
        chunks.push(buffer);
    }
    if (chunks.length === 0) return {};
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw.trim() === '') return {};
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        throw new BrokerHttpError('INVALID_REQUEST', 400, 'Request body must be valid JSON.');
    }
}

function typedError(
    code: BrokerTypedError['code'],
    message: string,
    options: {
        readonly field?: string;
        readonly toolId?: string;
        readonly requestId?: string;
        readonly traceId?: string;
    } = {},
): BrokerTypedError {
    return {
        code,
        message: sanitizeSummary(message),
        retryable: false,
        ...(options.field === undefined ? {} : { field: options.field }),
        ...(options.toolId === undefined ? {} : { tool_id: options.toolId }),
        ...(options.traceId === undefined ? {} : { trace_id: options.traceId }),
        ...(options.requestId === undefined ? {} : { request_id: options.requestId }),
    };
}

function toBrokerError(error: ToolCallError, context: BrokerPolicyContext): BrokerTypedError {
    return typedError(error.code, error.message, {
        ...(error.field === undefined ? {} : { field: error.field }),
        ...(error.toolId === undefined ? {} : { toolId: error.toolId }),
        requestId: context.requestId,
        traceId: context.traceId,
    });
}

function isDenyError(code: ToolCallError['code']): boolean {
    return code === 'ADAPTER_NOT_READ_ONLY'
        || code === 'MALFORMED_ARGS'
        || code === 'POLICY_DENIED'
        || code === 'UNKNOWN_TOOL'
        || code === 'WRITE_TOOL_DENIED';
}

function statusCodeForToolError(code: ToolCallError['code']): number {
    if (code === 'MALFORMED_ARGS') return 400;
    if (code === 'UNKNOWN_TOOL' || code === 'NOT_FOUND') return 404;
    if (code === 'POLICY_DENIED' || code === 'WRITE_TOOL_DENIED' || code === 'ADAPTER_NOT_READ_ONLY') return 403;
    return 400;
}

function toJsonRpcErrorCode(code: string | undefined): number {
    if (code === 'MALFORMED_ARGS' || code === 'INVALID_REQUEST') return -32602;
    if (code === 'UNKNOWN_TOOL') return -32601;
    if (code === 'UNSUPPORTED_METHOD') return -32601;
    return -32000;
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: Record<string, unknown>): Record<string, unknown> {
    return {
        jsonrpc: '2.0',
        id,
        error: {
            code,
            message: sanitizeSummary(message),
            ...(data === undefined ? {} : { data: sanitizeJsonRpcData(data) }),
        },
    };
}

function sanitizeJsonRpcData(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
            result[key] = value;
        }
    }
    return result;
}

function readJsonRpcId(body: unknown): JsonRpcId {
    if (!isRecord(body)) return null;
    if (typeof body.id === 'string' || typeof body.id === 'number' || body.id === null) return body.id;
    return null;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
    response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function writeSseReady(response: ServerResponse): void {
    response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
    });
    response.end(`event: ready\ndata: ${JSON.stringify({ endpoint: '/mcp/messages', service: SERVICE_NAME, status: 'ready' })}\n\n`);
}

function parsePort(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const port = Number.parseInt(raw, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`PORT must be an integer between 1 and 65535. Received: ${raw}`);
    }
    return port;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0];
    return value;
}

function getString(record: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = getUnknown(record, key);
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getUnknown(record: Record<string, unknown> | undefined, key: string): unknown {
    return record?.[key];
}

function firstString(values: readonly (string | null | undefined)[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return undefined;
}

function firstUnknown(values: readonly unknown[]): unknown {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
}

function stringList(values: readonly unknown[]): string[] {
    const result: string[] = [];
    for (const value of values) {
        if (typeof value === 'string') {
            result.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
        } else if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === 'string' && item.trim().length > 0) result.push(item.trim());
            }
        }
    }
    return [...new Set(result)];
}

function optionalPositiveInteger(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    if (typeof value === 'string' && /^\d+$/u.test(value)) {
        const parsed = Number.parseInt(value, 10);
        return parsed > 0 ? parsed : undefined;
    }
    return undefined;
}

function sanitizeSummary(value: string): string {
    return value.replace(/\s+/gu, ' ').slice(0, 240);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    startServer();
}
