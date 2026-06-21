CREATE TABLE "agent_definition" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_definition_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"agent_definition_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"agent_type" text NOT NULL,
	"version" text NOT NULL,
	"project_id" bigint NOT NULL,
	"owner_principal_id" bigint NOT NULL,
	"budget_scope_id" bigint,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"idempotency_key" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"capability_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skill_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trace_id" text,
	"request_id" text,
	"created_audit_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_definition_agent_type_check" CHECK ("agent_definition"."agent_type" IN ('supervisor', 'planner', 'researcher', 'synthesizer', 'reviewer', 'tool_executor', 'custom')),
	CONSTRAINT "agent_definition_status_check" CHECK ("agent_definition"."status" IN ('draft', 'eval_ready', 'approved', 'limited_rollout', 'production', 'disabled')),
	CONSTRAINT "agent_definition_production_enabled_false" CHECK ("agent_definition"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"agent_run_id" text NOT NULL,
	"agent_definition_id" bigint NOT NULL,
	"workflow_run_id" bigint,
	"workflow_step_id" bigint,
	"delegation_id" bigint,
	"task_ref" text NOT NULL,
	"project_id" bigint NOT NULL,
	"principal_id" bigint NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"idempotency_key" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"timeout_seconds" integer,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_audit_event_id" bigint,
	"completed_audit_event_id" bigint,
	"cost_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_state_check" CHECK ("agent_run"."state" IN ('queued', 'leased', 'running', 'waiting_on_child', 'succeeded', 'failed', 'cancelled', 'timed_out', 'denied')),
	CONSTRAINT "agent_run_production_enabled_false" CHECK ("agent_run"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "delegation" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "delegation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"delegation_id" text NOT NULL,
	"workflow_run_id" bigint NOT NULL,
	"workflow_step_id" bigint,
	"parent_delegation_id" bigint,
	"task_ref" text NOT NULL,
	"project_id" bigint NOT NULL,
	"requested_by_principal_id" bigint NOT NULL,
	"assigned_principal_id" bigint,
	"agent_definition_id" bigint,
	"budget_scope_id" bigint NOT NULL,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"idempotency_key" text,
	"state" text DEFAULT 'draft' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"timeout_seconds" integer,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_audit_event_id" bigint,
	"completed_audit_event_id" bigint,
	"cost_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegation_state_check" CHECK ("delegation"."state" IN ('draft', 'queued', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'denied')),
	CONSTRAINT "delegation_production_enabled_false" CHECK ("delegation"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "delegation_result" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "delegation_result_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"delegation_result_id" text NOT NULL,
	"delegation_id" bigint NOT NULL,
	"workflow_run_id" bigint NOT NULL,
	"agent_run_id" bigint,
	"project_id" bigint NOT NULL,
	"principal_id" bigint NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"result_ref" text,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audit_event_id" bigint,
	"cost_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegation_result_status_check" CHECK ("delegation_result"."status" IN ('succeeded', 'failed', 'cancelled', 'timed_out', 'denied', 'invalid_output')),
	CONSTRAINT "delegation_result_production_enabled_false" CHECK ("delegation_result"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "skill_definition" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "skill_definition_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"skill_definition_id" text NOT NULL,
	"skill_name" text NOT NULL,
	"skill_class" text NOT NULL,
	"project_id" bigint NOT NULL,
	"owner_principal_id" bigint NOT NULL,
	"budget_scope_id" bigint,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"idempotency_key" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"capability_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trace_id" text,
	"request_id" text,
	"created_audit_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_definition_skill_class_check" CHECK ("skill_definition"."skill_class" IN ('workflow', 'tool', 'analysis', 'retrieval', 'synthesis', 'guardrail')),
	CONSTRAINT "skill_definition_status_check" CHECK ("skill_definition"."status" IN ('draft', 'eval_ready', 'approved', 'limited_rollout', 'production', 'disabled')),
	CONSTRAINT "skill_definition_production_enabled_false" CHECK ("skill_definition"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "skill_version" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "skill_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"skill_version_id" text NOT NULL,
	"skill_definition_id" bigint NOT NULL,
	"version" text NOT NULL,
	"project_id" bigint NOT NULL,
	"released_by_principal_id" bigint,
	"budget_scope_id" bigint,
	"eval_gate_result_id" bigint,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"idempotency_key" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"package_artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trace_id" text,
	"request_id" text,
	"created_audit_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_version_status_check" CHECK ("skill_version"."status" IN ('draft', 'eval_ready', 'approved', 'limited_rollout', 'production', 'disabled')),
	CONSTRAINT "skill_version_production_enabled_false" CHECK ("skill_version"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "step_attempt" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "step_attempt_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"step_attempt_id" text NOT NULL,
	"workflow_run_id" bigint NOT NULL,
	"workflow_step_id" bigint NOT NULL,
	"delegation_id" bigint,
	"agent_run_id" bigint,
	"task_ref" text NOT NULL,
	"project_id" bigint NOT NULL,
	"principal_id" bigint NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"attempt_number" integer NOT NULL,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"idempotency_key" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"timeout_seconds" integer,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audit_event_id" bigint,
	"cost_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "step_attempt_state_check" CHECK ("step_attempt"."state" IN ('queued', 'running', 'succeeded', 'failed', 'denied', 'cancel_requested', 'cancelled', 'timed_out')),
	CONSTRAINT "step_attempt_production_enabled_false" CHECK ("step_attempt"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "task_artifact" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_artifact_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"task_artifact_id" text NOT NULL,
	"workflow_run_id" bigint,
	"workflow_step_id" bigint,
	"delegation_id" bigint,
	"agent_run_id" bigint,
	"tool_call_id" bigint,
	"task_ref" text NOT NULL,
	"project_id" bigint NOT NULL,
	"principal_id" bigint NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"artifact_type" text NOT NULL,
	"storage_uri" text NOT NULL,
	"content_hash" text,
	"hash_algorithm" text,
	"size_bytes" bigint,
	"sensitivity" text DEFAULT 'internal' NOT NULL,
	"retention_policy_ref" text NOT NULL,
	"artifact_storage_policy_ref" text NOT NULL,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"idempotency_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audit_event_id" bigint,
	"cost_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_artifact_status_check" CHECK ("task_artifact"."status" IN ('pending', 'available', 'redacted', 'expired', 'deleted')),
	CONSTRAINT "task_artifact_sensitivity_check" CHECK ("task_artifact"."sensitivity" IN ('public', 'internal', 'confidential', 'restricted')),
	CONSTRAINT "task_artifact_production_enabled_false" CHECK ("task_artifact"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "tool_call" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tool_call_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tool_call_id" text NOT NULL,
	"tool_definition_id" bigint NOT NULL,
	"tool_policy_id" bigint,
	"workflow_run_id" bigint,
	"workflow_step_id" bigint,
	"step_attempt_id" bigint,
	"delegation_id" bigint,
	"agent_run_id" bigint,
	"task_ref" text NOT NULL,
	"project_id" bigint NOT NULL,
	"principal_id" bigint NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"tool_class" text NOT NULL,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"idempotency_key" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"decision" text DEFAULT 'allow' NOT NULL,
	"denial_reason" text,
	"timeout_seconds" integer,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"input_artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audit_event_id" bigint,
	"cost_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_call_state_check" CHECK ("tool_call"."state" IN ('queued', 'running', 'succeeded', 'failed', 'denied', 'cancelled', 'timed_out')),
	CONSTRAINT "tool_call_decision_check" CHECK ("tool_call"."decision" IN ('allow', 'deny', 'review')),
	CONSTRAINT "tool_call_denial_reason_check" CHECK ("tool_call"."decision" <> 'deny' OR "tool_call"."denial_reason" IS NOT NULL),
	CONSTRAINT "tool_call_production_enabled_false" CHECK ("tool_call"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "tool_definition" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tool_definition_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tool_definition_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_class" text NOT NULL,
	"version" text NOT NULL,
	"project_id" bigint NOT NULL,
	"owner_principal_id" bigint NOT NULL,
	"budget_scope_id" bigint,
	"eval_gate_result_id" bigint,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"idempotency_key" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"input_schema_ref" text,
	"output_schema_ref" text,
	"capability_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trace_id" text,
	"request_id" text,
	"created_audit_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_definition_tool_class_check" CHECK ("tool_definition"."tool_class" IN ('agent', 'browser', 'code', 'database', 'filesystem', 'http', 'retrieval', 'system')),
	CONSTRAINT "tool_definition_status_check" CHECK ("tool_definition"."status" IN ('draft', 'active', 'disabled', 'archived')),
	CONSTRAINT "tool_definition_production_enabled_false" CHECK ("tool_definition"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "tool_policy" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tool_policy_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tool_policy_id" text NOT NULL,
	"tool_definition_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"principal_id" bigint,
	"budget_scope_id" bigint,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"idempotency_key" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"effect" text DEFAULT 'deny' NOT NULL,
	"rule_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trace_id" text,
	"request_id" text,
	"created_audit_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_policy_effect_check" CHECK ("tool_policy"."effect" IN ('allow', 'deny', 'review')),
	CONSTRAINT "tool_policy_status_check" CHECK ("tool_policy"."status" IN ('draft', 'active', 'disabled', 'archived')),
	CONSTRAINT "tool_policy_production_enabled_false" CHECK ("tool_policy"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "workflow_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workflow_event_id" text NOT NULL,
	"workflow_run_id" bigint NOT NULL,
	"workflow_step_id" bigint,
	"delegation_id" bigint,
	"agent_run_id" bigint,
	"tool_call_id" bigint,
	"task_artifact_id" bigint,
	"project_id" bigint NOT NULL,
	"principal_id" bigint NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"actor_principal_id" bigint,
	"sequence_number" integer NOT NULL,
	"event_type" text NOT NULL,
	"state" text,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audit_event_id" bigint,
	"cost_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"event_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_event_type_check" CHECK ("workflow_event"."event_type" IN ('workflow_created', 'state_transitioned', 'workflow_state_changed', 'step_created', 'step_state_changed', 'agent_run_started', 'delegation_created', 'delegation_completed', 'delegation_state_changed', 'tool_call_decided', 'agent_run_state_changed', 'tool_call_state_changed', 'artifact_recorded', 'budget_recorded', 'budget_reserved', 'cost_recorded', 'audit_recorded', 'heartbeat', 'lease_acquired', 'lease_released', 'workflow_completed', 'workflow_failed', 'error', 'cancel_requested')),
	CONSTRAINT "workflow_event_state_check" CHECK ("workflow_event"."state" IS NULL OR "workflow_event"."state" IN ('created', 'draft', 'queued', 'planning', 'delegating', 'dispatched', 'leased', 'running', 'waiting', 'waiting_on_child', 'synthesizing', 'succeeded', 'completed', 'failed', 'authorized', 'denied', 'invalid_output', 'skipped', 'cancel_requested', 'cancelled', 'timed_out')),
	CONSTRAINT "workflow_event_production_enabled_false" CHECK ("workflow_event"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "workflow_idempotency_key" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_idempotency_key_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workflow_idempotency_key_id" text NOT NULL,
	"project_id" bigint NOT NULL,
	"principal_id" bigint,
	"workflow_run_id" bigint,
	"workflow_step_id" bigint,
	"delegation_id" bigint,
	"agent_run_id" bigint,
	"tool_call_id" bigint,
	"task_artifact_id" bigint,
	"skill_definition_id" bigint,
	"skill_version_id" bigint,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"result_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"audit_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_idempotency_key_operation_check" CHECK ("workflow_idempotency_key"."operation" IN ('workflow_create', 'step_execute', 'delegation_create', 'agent_run', 'tool_call', 'artifact_write', 'skill_register', 'skill_version_register')),
	CONSTRAINT "workflow_idempotency_key_status_check" CHECK ("workflow_idempotency_key"."status" IN ('pending', 'in_progress', 'succeeded', 'failed', 'expired')),
	CONSTRAINT "workflow_idempotency_key_production_enabled_false" CHECK ("workflow_idempotency_key"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "workflow_lease" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_lease_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workflow_lease_id" text NOT NULL,
	"workflow_run_id" bigint NOT NULL,
	"workflow_step_id" bigint,
	"delegation_id" bigint,
	"agent_run_id" bigint,
	"project_id" bigint NOT NULL,
	"lease_key" text NOT NULL,
	"lease_owner" text NOT NULL,
	"lease_token_hash" text NOT NULL,
	"fencing_token" integer NOT NULL,
	"idempotency_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audit_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_lease_status_check" CHECK ("workflow_lease"."status" IN ('active', 'released', 'expired', 'lost')),
	CONSTRAINT "workflow_lease_production_enabled_false" CHECK ("workflow_lease"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workflow_run_id" text NOT NULL,
	"workflow_name" text NOT NULL,
	"task_ref" text NOT NULL,
	"project_id" bigint NOT NULL,
	"principal_id" bigint NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"root_agent_definition_id" bigint,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"idempotency_key" text,
	"state" text DEFAULT 'created' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"timeout_seconds" integer,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_audit_event_id" bigint,
	"completed_audit_event_id" bigint,
	"cost_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_state_check" CHECK ("workflow_run"."state" IN ('created', 'queued', 'planning', 'delegating', 'running', 'waiting_on_child', 'synthesizing', 'succeeded', 'completed', 'failed', 'cancel_requested', 'cancelled', 'timed_out', 'denied')),
	CONSTRAINT "workflow_run_production_enabled_false" CHECK ("workflow_run"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "workflow_step" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_step_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workflow_step_id" text NOT NULL,
	"workflow_run_id" bigint NOT NULL,
	"parent_workflow_step_id" bigint,
	"step_key" text NOT NULL,
	"step_type" text NOT NULL,
	"task_ref" text NOT NULL,
	"project_id" bigint NOT NULL,
	"principal_id" bigint NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"assigned_agent_definition_id" bigint,
	"data_class" text DEFAULT 'internal' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"idempotency_key" text,
	"state" text DEFAULT 'created' NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"timeout_seconds" integer,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"dependency_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_audit_event_id" bigint,
	"completed_audit_event_id" bigint,
	"cost_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_step_step_type_check" CHECK ("workflow_step"."step_type" IN ('plan', 'delegate', 'agent', 'tool', 'synthesize', 'review', 'artifact')),
	CONSTRAINT "workflow_step_state_check" CHECK ("workflow_step"."state" IN ('created', 'planning', 'delegating', 'running', 'synthesizing', 'completed', 'failed', 'skipped', 'cancel_requested', 'cancelled', 'timed_out')),
	CONSTRAINT "workflow_step_production_enabled_false" CHECK ("workflow_step"."production_enabled" = false)
);
--> statement-breakpoint
ALTER TABLE "budget_scope" DROP CONSTRAINT "budget_scope_scope_type_check";--> statement-breakpoint
ALTER TABLE "cost_event" ADD COLUMN "workflow_run_id" bigint;--> statement-breakpoint
ALTER TABLE "cost_event" ADD COLUMN "delegation_id" bigint;--> statement-breakpoint
ALTER TABLE "cost_event" ADD COLUMN "tool_class" text;--> statement-breakpoint
ALTER TABLE "agent_definition" ADD CONSTRAINT "agent_definition_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition" ADD CONSTRAINT "agent_definition_owner_principal_id_principal_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition" ADD CONSTRAINT "agent_definition_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition" ADD CONSTRAINT "agent_definition_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_definition_id_agent_definition_id_fk" FOREIGN KEY ("agent_definition_id") REFERENCES "public"."agent_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_completed_audit_event_id_audit_event_id_fk" FOREIGN KEY ("completed_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_parent_delegation_id_delegation_id_fk" FOREIGN KEY ("parent_delegation_id") REFERENCES "public"."delegation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_requested_by_principal_id_principal_id_fk" FOREIGN KEY ("requested_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_assigned_principal_id_principal_id_fk" FOREIGN KEY ("assigned_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_agent_definition_id_agent_definition_id_fk" FOREIGN KEY ("agent_definition_id") REFERENCES "public"."agent_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_completed_audit_event_id_audit_event_id_fk" FOREIGN KEY ("completed_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_result" ADD CONSTRAINT "delegation_result_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_result" ADD CONSTRAINT "delegation_result_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_result" ADD CONSTRAINT "delegation_result_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_result" ADD CONSTRAINT "delegation_result_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_result" ADD CONSTRAINT "delegation_result_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_result" ADD CONSTRAINT "delegation_result_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_result" ADD CONSTRAINT "delegation_result_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_result" ADD CONSTRAINT "delegation_result_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_definition" ADD CONSTRAINT "skill_definition_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_definition" ADD CONSTRAINT "skill_definition_owner_principal_id_principal_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_definition" ADD CONSTRAINT "skill_definition_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_definition" ADD CONSTRAINT "skill_definition_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_skill_definition_id_skill_definition_id_fk" FOREIGN KEY ("skill_definition_id") REFERENCES "public"."skill_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_released_by_principal_id_principal_id_fk" FOREIGN KEY ("released_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_eval_gate_result_id_eval_gate_result_id_fk" FOREIGN KEY ("eval_gate_result_id") REFERENCES "public"."eval_gate_result"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_tool_call_id_tool_call_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_call"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_tool_definition_id_tool_definition_id_fk" FOREIGN KEY ("tool_definition_id") REFERENCES "public"."tool_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_tool_policy_id_tool_policy_id_fk" FOREIGN KEY ("tool_policy_id") REFERENCES "public"."tool_policy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_step_attempt_id_step_attempt_id_fk" FOREIGN KEY ("step_attempt_id") REFERENCES "public"."step_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_definition" ADD CONSTRAINT "tool_definition_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_definition" ADD CONSTRAINT "tool_definition_owner_principal_id_principal_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_definition" ADD CONSTRAINT "tool_definition_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_definition" ADD CONSTRAINT "tool_definition_eval_gate_result_id_eval_gate_result_id_fk" FOREIGN KEY ("eval_gate_result_id") REFERENCES "public"."eval_gate_result"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_definition" ADD CONSTRAINT "tool_definition_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_policy" ADD CONSTRAINT "tool_policy_tool_definition_id_tool_definition_id_fk" FOREIGN KEY ("tool_definition_id") REFERENCES "public"."tool_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_policy" ADD CONSTRAINT "tool_policy_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_policy" ADD CONSTRAINT "tool_policy_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_policy" ADD CONSTRAINT "tool_policy_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_policy" ADD CONSTRAINT "tool_policy_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_tool_call_id_tool_call_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_call"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_task_artifact_id_task_artifact_id_fk" FOREIGN KEY ("task_artifact_id") REFERENCES "public"."task_artifact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_actor_principal_id_principal_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_tool_call_id_tool_call_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_call"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_task_artifact_id_task_artifact_id_fk" FOREIGN KEY ("task_artifact_id") REFERENCES "public"."task_artifact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_skill_definition_id_skill_definition_id_fk" FOREIGN KEY ("skill_definition_id") REFERENCES "public"."skill_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_skill_version_id_skill_version_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."skill_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_lease" ADD CONSTRAINT "workflow_lease_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_lease" ADD CONSTRAINT "workflow_lease_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_lease" ADD CONSTRAINT "workflow_lease_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_lease" ADD CONSTRAINT "workflow_lease_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_lease" ADD CONSTRAINT "workflow_lease_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_lease" ADD CONSTRAINT "workflow_lease_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_root_agent_definition_id_agent_definition_id_fk" FOREIGN KEY ("root_agent_definition_id") REFERENCES "public"."agent_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_completed_audit_event_id_audit_event_id_fk" FOREIGN KEY ("completed_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_parent_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("parent_workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_assigned_agent_definition_id_agent_definition_id_fk" FOREIGN KEY ("assigned_agent_definition_id") REFERENCES "public"."agent_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_completed_audit_event_id_audit_event_id_fk" FOREIGN KEY ("completed_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definition_agent_definition_id_key" ON "agent_definition" USING btree ("agent_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definition_name_version_registry_key" ON "agent_definition" USING btree ("agent_name","version","registry_version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definition_idempotency_key_key" ON "agent_definition" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_definition_project_id_idx" ON "agent_definition" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_definition_owner_principal_id_idx" ON "agent_definition" USING btree ("owner_principal_id");--> statement-breakpoint
CREATE INDEX "agent_definition_budget_scope_id_idx" ON "agent_definition" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "agent_definition_policy_registry_idx" ON "agent_definition" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "agent_definition_trace_id_idx" ON "agent_definition" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "agent_definition_request_id_idx" ON "agent_definition" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "agent_definition_created_audit_event_id_idx" ON "agent_definition" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_agent_run_id_key" ON "agent_run" USING btree ("agent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_idempotency_key_key" ON "agent_run" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_run_agent_definition_id_idx" ON "agent_run" USING btree ("agent_definition_id");--> statement-breakpoint
CREATE INDEX "agent_run_workflow_run_id_idx" ON "agent_run" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "agent_run_workflow_step_id_idx" ON "agent_run" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "agent_run_delegation_id_idx" ON "agent_run" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "agent_run_project_id_idx" ON "agent_run" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_run_principal_id_idx" ON "agent_run" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "agent_run_budget_scope_id_idx" ON "agent_run" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "agent_run_policy_registry_idx" ON "agent_run" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "agent_run_trace_id_idx" ON "agent_run" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "agent_run_request_id_idx" ON "agent_run" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "agent_run_state_created_at_idx" ON "agent_run" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "agent_run_lease_expires_at_idx" ON "agent_run" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "agent_run_created_audit_event_id_idx" ON "agent_run" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE INDEX "agent_run_completed_audit_event_id_idx" ON "agent_run" USING btree ("completed_audit_event_id");--> statement-breakpoint
CREATE INDEX "agent_run_cost_event_id_idx" ON "agent_run" USING btree ("cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_delegation_id_key" ON "delegation" USING btree ("delegation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_idempotency_key_key" ON "delegation" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "delegation_workflow_run_id_idx" ON "delegation" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "delegation_workflow_step_id_idx" ON "delegation" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "delegation_parent_delegation_id_idx" ON "delegation" USING btree ("parent_delegation_id");--> statement-breakpoint
CREATE INDEX "delegation_project_id_idx" ON "delegation" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "delegation_requested_by_principal_id_idx" ON "delegation" USING btree ("requested_by_principal_id");--> statement-breakpoint
CREATE INDEX "delegation_assigned_principal_id_idx" ON "delegation" USING btree ("assigned_principal_id");--> statement-breakpoint
CREATE INDEX "delegation_agent_definition_id_idx" ON "delegation" USING btree ("agent_definition_id");--> statement-breakpoint
CREATE INDEX "delegation_budget_scope_id_idx" ON "delegation" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "delegation_policy_registry_idx" ON "delegation" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "delegation_trace_id_idx" ON "delegation" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "delegation_request_id_idx" ON "delegation" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "delegation_state_created_at_idx" ON "delegation" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "delegation_lease_expires_at_idx" ON "delegation" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "delegation_created_audit_event_id_idx" ON "delegation" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE INDEX "delegation_completed_audit_event_id_idx" ON "delegation" USING btree ("completed_audit_event_id");--> statement-breakpoint
CREATE INDEX "delegation_cost_event_id_idx" ON "delegation" USING btree ("cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_result_delegation_result_id_key" ON "delegation_result" USING btree ("delegation_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_result_delegation_id_key" ON "delegation_result" USING btree ("delegation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delegation_result_idempotency_key_key" ON "delegation_result" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "delegation_result_workflow_run_id_idx" ON "delegation_result" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "delegation_result_agent_run_id_idx" ON "delegation_result" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "delegation_result_project_id_idx" ON "delegation_result" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "delegation_result_principal_id_idx" ON "delegation_result" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "delegation_result_budget_scope_id_idx" ON "delegation_result" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "delegation_result_policy_registry_idx" ON "delegation_result" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "delegation_result_trace_id_idx" ON "delegation_result" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "delegation_result_request_id_idx" ON "delegation_result" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "delegation_result_audit_event_id_idx" ON "delegation_result" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "delegation_result_cost_event_id_idx" ON "delegation_result" USING btree ("cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_definition_skill_definition_id_key" ON "skill_definition" USING btree ("skill_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_definition_name_registry_key" ON "skill_definition" USING btree ("skill_name","registry_version");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_definition_idempotency_key_key" ON "skill_definition" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "skill_definition_project_id_idx" ON "skill_definition" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "skill_definition_owner_principal_id_idx" ON "skill_definition" USING btree ("owner_principal_id");--> statement-breakpoint
CREATE INDEX "skill_definition_budget_scope_id_idx" ON "skill_definition" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "skill_definition_policy_registry_idx" ON "skill_definition" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "skill_definition_trace_id_idx" ON "skill_definition" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "skill_definition_request_id_idx" ON "skill_definition" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "skill_definition_created_audit_event_id_idx" ON "skill_definition" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_version_skill_version_id_key" ON "skill_version" USING btree ("skill_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_version_definition_version_key" ON "skill_version" USING btree ("skill_definition_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_version_idempotency_key_key" ON "skill_version" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "skill_version_skill_definition_id_idx" ON "skill_version" USING btree ("skill_definition_id");--> statement-breakpoint
CREATE INDEX "skill_version_project_id_idx" ON "skill_version" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "skill_version_released_by_principal_id_idx" ON "skill_version" USING btree ("released_by_principal_id");--> statement-breakpoint
CREATE INDEX "skill_version_budget_scope_id_idx" ON "skill_version" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "skill_version_eval_gate_result_id_idx" ON "skill_version" USING btree ("eval_gate_result_id");--> statement-breakpoint
CREATE INDEX "skill_version_policy_registry_idx" ON "skill_version" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "skill_version_trace_id_idx" ON "skill_version" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "skill_version_request_id_idx" ON "skill_version" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "skill_version_created_audit_event_id_idx" ON "skill_version" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "step_attempt_step_attempt_id_key" ON "step_attempt" USING btree ("step_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "step_attempt_step_number_key" ON "step_attempt" USING btree ("workflow_step_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "step_attempt_idempotency_key_key" ON "step_attempt" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "step_attempt_workflow_run_id_idx" ON "step_attempt" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "step_attempt_workflow_step_id_idx" ON "step_attempt" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "step_attempt_delegation_id_idx" ON "step_attempt" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "step_attempt_agent_run_id_idx" ON "step_attempt" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "step_attempt_project_id_idx" ON "step_attempt" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "step_attempt_principal_id_idx" ON "step_attempt" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "step_attempt_budget_scope_id_idx" ON "step_attempt" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "step_attempt_policy_registry_idx" ON "step_attempt" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "step_attempt_trace_id_idx" ON "step_attempt" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "step_attempt_request_id_idx" ON "step_attempt" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "step_attempt_state_created_at_idx" ON "step_attempt" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "step_attempt_lease_expires_at_idx" ON "step_attempt" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "step_attempt_audit_event_id_idx" ON "step_attempt" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "step_attempt_cost_event_id_idx" ON "step_attempt" USING btree ("cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_artifact_task_artifact_id_key" ON "task_artifact" USING btree ("task_artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_artifact_idempotency_key_key" ON "task_artifact" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "task_artifact_workflow_run_id_idx" ON "task_artifact" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "task_artifact_workflow_step_id_idx" ON "task_artifact" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "task_artifact_delegation_id_idx" ON "task_artifact" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "task_artifact_agent_run_id_idx" ON "task_artifact" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "task_artifact_tool_call_id_idx" ON "task_artifact" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "task_artifact_project_id_idx" ON "task_artifact" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_artifact_principal_id_idx" ON "task_artifact" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "task_artifact_budget_scope_id_idx" ON "task_artifact" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "task_artifact_policy_registry_idx" ON "task_artifact" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "task_artifact_trace_id_idx" ON "task_artifact" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "task_artifact_request_id_idx" ON "task_artifact" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "task_artifact_storage_uri_idx" ON "task_artifact" USING btree ("storage_uri");--> statement-breakpoint
CREATE INDEX "task_artifact_status_created_at_idx" ON "task_artifact" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "task_artifact_expires_at_idx" ON "task_artifact" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "task_artifact_audit_event_id_idx" ON "task_artifact" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "task_artifact_cost_event_id_idx" ON "task_artifact" USING btree ("cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_call_tool_call_id_key" ON "tool_call" USING btree ("tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_call_idempotency_key_key" ON "tool_call" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "tool_call_tool_definition_id_idx" ON "tool_call" USING btree ("tool_definition_id");--> statement-breakpoint
CREATE INDEX "tool_call_tool_policy_id_idx" ON "tool_call" USING btree ("tool_policy_id");--> statement-breakpoint
CREATE INDEX "tool_call_workflow_run_id_idx" ON "tool_call" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "tool_call_workflow_step_id_idx" ON "tool_call" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "tool_call_step_attempt_id_idx" ON "tool_call" USING btree ("step_attempt_id");--> statement-breakpoint
CREATE INDEX "tool_call_delegation_id_idx" ON "tool_call" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "tool_call_agent_run_id_idx" ON "tool_call" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "tool_call_project_id_idx" ON "tool_call" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tool_call_principal_id_idx" ON "tool_call" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "tool_call_budget_scope_id_idx" ON "tool_call" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "tool_call_tool_class_created_at_idx" ON "tool_call" USING btree ("tool_class","created_at");--> statement-breakpoint
CREATE INDEX "tool_call_policy_registry_idx" ON "tool_call" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "tool_call_trace_id_idx" ON "tool_call" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "tool_call_request_id_idx" ON "tool_call" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "tool_call_state_created_at_idx" ON "tool_call" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "tool_call_lease_expires_at_idx" ON "tool_call" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "tool_call_audit_event_id_idx" ON "tool_call" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "tool_call_cost_event_id_idx" ON "tool_call" USING btree ("cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_definition_tool_definition_id_key" ON "tool_definition" USING btree ("tool_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_definition_name_version_registry_key" ON "tool_definition" USING btree ("tool_name","version","registry_version");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_definition_idempotency_key_key" ON "tool_definition" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "tool_definition_project_id_idx" ON "tool_definition" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tool_definition_owner_principal_id_idx" ON "tool_definition" USING btree ("owner_principal_id");--> statement-breakpoint
CREATE INDEX "tool_definition_budget_scope_id_idx" ON "tool_definition" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "tool_definition_eval_gate_result_id_idx" ON "tool_definition" USING btree ("eval_gate_result_id");--> statement-breakpoint
CREATE INDEX "tool_definition_tool_class_idx" ON "tool_definition" USING btree ("tool_class");--> statement-breakpoint
CREATE INDEX "tool_definition_policy_registry_idx" ON "tool_definition" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "tool_definition_trace_id_idx" ON "tool_definition" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "tool_definition_request_id_idx" ON "tool_definition" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "tool_definition_created_audit_event_id_idx" ON "tool_definition" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_policy_tool_policy_id_key" ON "tool_policy" USING btree ("tool_policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_policy_idempotency_key_key" ON "tool_policy" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "tool_policy_tool_definition_id_idx" ON "tool_policy" USING btree ("tool_definition_id");--> statement-breakpoint
CREATE INDEX "tool_policy_project_id_idx" ON "tool_policy" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tool_policy_principal_id_idx" ON "tool_policy" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "tool_policy_budget_scope_id_idx" ON "tool_policy" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "tool_policy_policy_registry_idx" ON "tool_policy" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "tool_policy_trace_id_idx" ON "tool_policy" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "tool_policy_request_id_idx" ON "tool_policy" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "tool_policy_created_audit_event_id_idx" ON "tool_policy" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_event_workflow_event_id_key" ON "workflow_event" USING btree ("workflow_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_event_run_sequence_key" ON "workflow_event" USING btree ("workflow_run_id","sequence_number");--> statement-breakpoint
CREATE INDEX "workflow_event_workflow_step_id_idx" ON "workflow_event" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "workflow_event_delegation_id_idx" ON "workflow_event" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "workflow_event_agent_run_id_idx" ON "workflow_event" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "workflow_event_tool_call_id_idx" ON "workflow_event" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "workflow_event_task_artifact_id_idx" ON "workflow_event" USING btree ("task_artifact_id");--> statement-breakpoint
CREATE INDEX "workflow_event_project_id_idx" ON "workflow_event" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_event_principal_id_idx" ON "workflow_event" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "workflow_event_budget_scope_id_idx" ON "workflow_event" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "workflow_event_actor_principal_id_idx" ON "workflow_event" USING btree ("actor_principal_id");--> statement-breakpoint
CREATE INDEX "workflow_event_type_time_idx" ON "workflow_event" USING btree ("event_type","event_time");--> statement-breakpoint
CREATE INDEX "workflow_event_policy_registry_idx" ON "workflow_event" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "workflow_event_trace_id_idx" ON "workflow_event" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "workflow_event_request_id_idx" ON "workflow_event" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "workflow_event_audit_event_id_idx" ON "workflow_event" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "workflow_event_cost_event_id_idx" ON "workflow_event" USING btree ("cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_idempotency_key_id_key" ON "workflow_idempotency_key" USING btree ("workflow_idempotency_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_idempotency_key_operation_key" ON "workflow_idempotency_key" USING btree ("project_id","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_project_id_idx" ON "workflow_idempotency_key" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_principal_id_idx" ON "workflow_idempotency_key" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_workflow_run_id_idx" ON "workflow_idempotency_key" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_workflow_step_id_idx" ON "workflow_idempotency_key" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_delegation_id_idx" ON "workflow_idempotency_key" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_agent_run_id_idx" ON "workflow_idempotency_key" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_tool_call_id_idx" ON "workflow_idempotency_key" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_task_artifact_id_idx" ON "workflow_idempotency_key" USING btree ("task_artifact_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_skill_definition_id_idx" ON "workflow_idempotency_key" USING btree ("skill_definition_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_skill_version_id_idx" ON "workflow_idempotency_key" USING btree ("skill_version_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_trace_id_idx" ON "workflow_idempotency_key" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_request_id_idx" ON "workflow_idempotency_key" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_expires_at_idx" ON "workflow_idempotency_key" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workflow_idempotency_key_audit_event_id_idx" ON "workflow_idempotency_key" USING btree ("audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_lease_workflow_lease_id_key" ON "workflow_lease" USING btree ("workflow_lease_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_lease_lease_token_hash_key" ON "workflow_lease" USING btree ("lease_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_lease_idempotency_key_key" ON "workflow_lease" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "workflow_lease_workflow_run_id_idx" ON "workflow_lease" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_lease_workflow_step_id_idx" ON "workflow_lease" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "workflow_lease_delegation_id_idx" ON "workflow_lease" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "workflow_lease_agent_run_id_idx" ON "workflow_lease" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "workflow_lease_project_id_idx" ON "workflow_lease" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_lease_key_status_idx" ON "workflow_lease" USING btree ("lease_key","status");--> statement-breakpoint
CREATE INDEX "workflow_lease_expires_at_idx" ON "workflow_lease" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workflow_lease_trace_id_idx" ON "workflow_lease" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "workflow_lease_request_id_idx" ON "workflow_lease" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "workflow_lease_audit_event_id_idx" ON "workflow_lease" USING btree ("audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_workflow_run_id_key" ON "workflow_run" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_idempotency_key_key" ON "workflow_run" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "workflow_run_project_id_idx" ON "workflow_run" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_run_principal_id_idx" ON "workflow_run" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "workflow_run_budget_scope_id_idx" ON "workflow_run" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "workflow_run_root_agent_definition_id_idx" ON "workflow_run" USING btree ("root_agent_definition_id");--> statement-breakpoint
CREATE INDEX "workflow_run_policy_registry_idx" ON "workflow_run" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "workflow_run_trace_id_idx" ON "workflow_run" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "workflow_run_request_id_idx" ON "workflow_run" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "workflow_run_state_created_at_idx" ON "workflow_run" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "workflow_run_lease_expires_at_idx" ON "workflow_run" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "workflow_run_created_audit_event_id_idx" ON "workflow_run" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE INDEX "workflow_run_completed_audit_event_id_idx" ON "workflow_run" USING btree ("completed_audit_event_id");--> statement-breakpoint
CREATE INDEX "workflow_run_cost_event_id_idx" ON "workflow_run" USING btree ("cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_workflow_step_id_key" ON "workflow_step" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_workflow_run_step_key_key" ON "workflow_step" USING btree ("workflow_run_id","step_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_idempotency_key_key" ON "workflow_step" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "workflow_step_workflow_run_id_idx" ON "workflow_step" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_step_parent_workflow_step_id_idx" ON "workflow_step" USING btree ("parent_workflow_step_id");--> statement-breakpoint
CREATE INDEX "workflow_step_project_id_idx" ON "workflow_step" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_step_principal_id_idx" ON "workflow_step" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "workflow_step_budget_scope_id_idx" ON "workflow_step" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "workflow_step_assigned_agent_definition_id_idx" ON "workflow_step" USING btree ("assigned_agent_definition_id");--> statement-breakpoint
CREATE INDEX "workflow_step_run_state_ordinal_idx" ON "workflow_step" USING btree ("workflow_run_id","state","ordinal");--> statement-breakpoint
CREATE INDEX "workflow_step_policy_registry_idx" ON "workflow_step" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "workflow_step_trace_id_idx" ON "workflow_step" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "workflow_step_request_id_idx" ON "workflow_step" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "workflow_step_lease_expires_at_idx" ON "workflow_step" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "workflow_step_created_audit_event_id_idx" ON "workflow_step" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE INDEX "workflow_step_completed_audit_event_id_idx" ON "workflow_step" USING btree ("completed_audit_event_id");--> statement-breakpoint
CREATE INDEX "workflow_step_cost_event_id_idx" ON "workflow_step" USING btree ("cost_event_id");--> statement-breakpoint
CREATE INDEX "cost_event_workflow_run_id_idx" ON "cost_event" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "cost_event_delegation_id_idx" ON "cost_event" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "cost_event_tool_class_created_at_idx" ON "cost_event" USING btree ("tool_class","created_at");--> statement-breakpoint
ALTER TABLE "budget_scope" ADD CONSTRAINT "budget_scope_scope_type_check" CHECK ("budget_scope"."scope_type" IN ('org', 'team', 'project', 'principal', 'virtual_key', 'workflow', 'delegation', 'tool_class'));