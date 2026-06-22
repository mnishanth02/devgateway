CREATE TABLE "approval_request" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "approval_request_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"approval_request_id" text NOT NULL,
	"workflow_run_id" bigint,
	"task_id" text NOT NULL,
	"workflow_step_id" bigint,
	"delegation_id" bigint,
	"tool_call_id" bigint,
	"requester_principal_id" bigint NOT NULL,
	"approver_principal_id" bigint,
	"required_role_id" bigint,
	"approver_policy_ref" text,
	"approver_policy_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_tier" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"action_summary_artifact_id" bigint,
	"decision_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision_audit_event_id" bigint,
	"expires_at" timestamp with time zone,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text,
	"data_ref" text,
	"budget_scope_id" bigint,
	"project_id" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_request_risk_tier_check" CHECK ("approval_request"."risk_tier" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "approval_request_state_check" CHECK ("approval_request"."state" IN ('pending', 'approved', 'denied', 'expired', 'cancelled', 'superseded')),
	CONSTRAINT "approval_request_approved_proof_check" CHECK ("approval_request"."state" <> 'approved' OR ("approval_request"."approver_principal_id" IS NOT NULL AND "approval_request"."required_role_id" IS NOT NULL AND "approval_request"."approver_policy_ref" IS NOT NULL AND "approval_request"."action_summary_artifact_id" IS NOT NULL AND "approval_request"."decision_audit_event_id" IS NOT NULL)),
	CONSTRAINT "approval_request_production_enabled_false" CHECK ("approval_request"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "artifact_lifecycle_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "artifact_lifecycle_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"artifact_lifecycle_event_id" text NOT NULL,
	"task_artifact_id" bigint NOT NULL,
	"action" text NOT NULL,
	"state" text NOT NULL,
	"storage_ref" text,
	"content_hash" text,
	"hash_algorithm" text,
	"size_bytes" bigint,
	"media_type" text,
	"retention_policy_ref" text,
	"legal_hold_ref" text,
	"signed_access_eligible" boolean DEFAULT false NOT NULL,
	"signed_access_requires_approval" boolean DEFAULT true NOT NULL,
	"signed_access_max_duration_seconds" integer,
	"redaction_ref" text,
	"expires_at" timestamp with time zone,
	"deletion_ref" text,
	"audit_event_id" bigint,
	"idempotency_key" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"project_id" bigint NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_lifecycle_event_action_check" CHECK ("artifact_lifecycle_event"."action" IN ('created', 'verified', 'expiry_set', 'retained', 'legal_hold_applied', 'legal_hold_released', 'redacted', 'deletion_scheduled', 'deleted', 'signed_access_granted', 'signed_access_revoked')),
	CONSTRAINT "artifact_lifecycle_event_state_check" CHECK ("artifact_lifecycle_event"."state" IN ('pending', 'active', 'expiring', 'redacted', 'expired', 'deletion_pending', 'deleted', 'legal_hold_active')),
	CONSTRAINT "artifact_lifecycle_event_signed_access_duration_check" CHECK ("artifact_lifecycle_event"."signed_access_max_duration_seconds" IS NULL OR "artifact_lifecycle_event"."signed_access_max_duration_seconds" > 0),
	CONSTRAINT "artifact_lifecycle_event_signed_access_policy_check" CHECK ("artifact_lifecycle_event"."signed_access_eligible" = false OR "artifact_lifecycle_event"."signed_access_requires_approval" = true),
	CONSTRAINT "artifact_lifecycle_event_production_enabled_false" CHECK ("artifact_lifecycle_event"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "manual_review_item" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manual_review_item_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"manual_review_item_id" text NOT NULL,
	"reason" text NOT NULL,
	"workflow_run_id" bigint,
	"workflow_step_id" bigint,
	"step_attempt_id" bigint,
	"delegation_id" bigint,
	"agent_run_id" bigint,
	"tool_call_id" bigint,
	"owner_principal_id" bigint NOT NULL,
	"owner_role_id" bigint,
	"blocking_state" text DEFAULT 'blocking_workflow' NOT NULL,
	"review_state" text DEFAULT 'open' NOT NULL,
	"safe_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"side_effect_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolution_ref" text,
	"resolution_audit_event_id" bigint,
	"idempotency_key" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"project_id" bigint NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_review_item_blocking_state_check" CHECK ("manual_review_item"."blocking_state" IN ('blocking_workflow', 'blocking_step', 'informational')),
	CONSTRAINT "manual_review_item_review_state_check" CHECK ("manual_review_item"."review_state" IN ('open', 'in_progress', 'resolved', 'closed')),
	CONSTRAINT "manual_review_item_production_enabled_false" CHECK ("manual_review_item"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "workflow_cancellation" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_cancellation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workflow_cancellation_id" text NOT NULL,
	"workflow_run_id" bigint NOT NULL,
	"task_ref" text,
	"requester_principal_id" bigint NOT NULL,
	"reason" text NOT NULL,
	"propagation_state" text DEFAULT 'requested' NOT NULL,
	"target_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deadline" timestamp with time zone,
	"budget_release_ref" text,
	"terminal_ref" text,
	"manual_review_ref" text,
	"audit_event_id" bigint,
	"idempotency_key" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"project_id" bigint NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_cancellation_propagation_state_check" CHECK ("workflow_cancellation"."propagation_state" IN ('requested', 'propagating', 'pending_manual_review', 'unwinding', 'releasing_reservations', 'completed', 'partially_completed', 'partially_completed_manual_review')),
	CONSTRAINT "workflow_cancellation_production_enabled_false" CHECK ("workflow_cancellation"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "workflow_outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"outbox_id" text NOT NULL,
	"workflow_run_id" bigint NOT NULL,
	"source_workflow_event_id" bigint NOT NULL,
	"destination_kind" text NOT NULL,
	"payload_artifact_id" bigint,
	"delivery_state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_failure_ref" text,
	"idempotency_key" text NOT NULL,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"project_id" bigint NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_outbox_destination_kind_check" CHECK ("workflow_outbox"."destination_kind" IN ('trace', 'audit', 'notification', 'eval_evidence', 'portal_update', 'webhook_ref')),
	CONSTRAINT "workflow_outbox_delivery_state_check" CHECK ("workflow_outbox"."delivery_state" IN ('pending', 'delivering', 'delivered', 'failed', 'dead_lettered')),
	CONSTRAINT "workflow_outbox_production_enabled_false" CHECK ("workflow_outbox"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "workflow_template" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_template_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workflow_template_id" text NOT NULL,
	"template_name" text NOT NULL,
	"owner_principal_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_template_status_check" CHECK ("workflow_template"."status" IN ('draft', 'eval_ready', 'approved', 'limited_rollout', 'production', 'disabled')),
	CONSTRAINT "workflow_template_production_enabled_false" CHECK ("workflow_template"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "workflow_template_version" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_template_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workflow_template_version_id" text NOT NULL,
	"workflow_template_id" bigint NOT NULL,
	"version" text NOT NULL,
	"project_id" bigint NOT NULL,
	"owner_principal_id" bigint NOT NULL,
	"eval_gate_result_id" bigint,
	"rollout_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eval_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_graph_ref" text,
	"allowed_tool_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_model_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_approval_policy_ref" text,
	"retry_policy_ref" text,
	"cancel_policy_ref" text,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_audit_event_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_template_version_status_check" CHECK ("workflow_template_version"."status" IN ('draft', 'eval_ready', 'approved', 'limited_rollout', 'production', 'disabled')),
	CONSTRAINT "workflow_template_version_production_enabled_false" CHECK ("workflow_template_version"."production_enabled" = false)
);
--> statement-breakpoint
ALTER TABLE "workflow_event" DROP CONSTRAINT "workflow_event_type_check";--> statement-breakpoint
ALTER TABLE "workflow_event" DROP CONSTRAINT "workflow_event_state_check";--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" DROP CONSTRAINT "workflow_idempotency_key_operation_check";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP CONSTRAINT "workflow_run_state_check";--> statement-breakpoint
ALTER TABLE "workflow_step" DROP CONSTRAINT "workflow_step_step_type_check";--> statement-breakpoint
ALTER TABLE "workflow_step" DROP CONSTRAINT "workflow_step_state_check";--> statement-breakpoint
ALTER TABLE "step_attempt" ADD COLUMN "retry_policy_ref" text;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD COLUMN "external_request_ref" text;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD COLUMN "fencing_token" integer;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD COLUMN "replay_decision" text;--> statement-breakpoint
ALTER TABLE "step_attempt" ADD COLUMN "failure_class" text;--> statement-breakpoint
ALTER TABLE "workflow_lease" ADD COLUMN "manual_review_status" text;--> statement-breakpoint
ALTER TABLE "workflow_lease" ADD COLUMN "recovery_reason" text;--> statement-breakpoint
ALTER TABLE "workflow_lease" ADD COLUMN "sweep_evidence_ref" text;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "template_version_id" bigint;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "pause_state" text;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "cancellation_ref" text;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "manual_review_status" text;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "durable_runtime_version" text;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD COLUMN "retry_policy_ref" text;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD COLUMN "failure_class" text;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_tool_call_id_tool_call_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_call"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requester_principal_id_principal_id_fk" FOREIGN KEY ("requester_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_approver_principal_id_principal_id_fk" FOREIGN KEY ("approver_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_required_role_id_role_id_fk" FOREIGN KEY ("required_role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_action_summary_artifact_id_task_artifact_id_fk" FOREIGN KEY ("action_summary_artifact_id") REFERENCES "public"."task_artifact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decision_audit_event_id_audit_event_id_fk" FOREIGN KEY ("decision_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_lifecycle_event" ADD CONSTRAINT "artifact_lifecycle_event_task_artifact_id_task_artifact_id_fk" FOREIGN KEY ("task_artifact_id") REFERENCES "public"."task_artifact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_lifecycle_event" ADD CONSTRAINT "artifact_lifecycle_event_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_lifecycle_event" ADD CONSTRAINT "artifact_lifecycle_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_item" ADD CONSTRAINT "manual_review_item_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_item" ADD CONSTRAINT "manual_review_item_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_item" ADD CONSTRAINT "manual_review_item_step_attempt_id_step_attempt_id_fk" FOREIGN KEY ("step_attempt_id") REFERENCES "public"."step_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_item" ADD CONSTRAINT "manual_review_item_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_item" ADD CONSTRAINT "manual_review_item_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_item" ADD CONSTRAINT "manual_review_item_tool_call_id_tool_call_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_call"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_item" ADD CONSTRAINT "manual_review_item_owner_principal_id_principal_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_item" ADD CONSTRAINT "manual_review_item_owner_role_id_role_id_fk" FOREIGN KEY ("owner_role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_item" ADD CONSTRAINT "manual_review_item_resolution_audit_event_id_audit_event_id_fk" FOREIGN KEY ("resolution_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_review_item" ADD CONSTRAINT "manual_review_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_cancellation" ADD CONSTRAINT "workflow_cancellation_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_cancellation" ADD CONSTRAINT "workflow_cancellation_requester_principal_id_principal_id_fk" FOREIGN KEY ("requester_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_cancellation" ADD CONSTRAINT "workflow_cancellation_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_cancellation" ADD CONSTRAINT "workflow_cancellation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_outbox" ADD CONSTRAINT "workflow_outbox_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_outbox" ADD CONSTRAINT "workflow_outbox_source_workflow_event_id_workflow_event_id_fk" FOREIGN KEY ("source_workflow_event_id") REFERENCES "public"."workflow_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_outbox" ADD CONSTRAINT "workflow_outbox_payload_artifact_id_task_artifact_id_fk" FOREIGN KEY ("payload_artifact_id") REFERENCES "public"."task_artifact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_outbox" ADD CONSTRAINT "workflow_outbox_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template" ADD CONSTRAINT "workflow_template_owner_principal_id_principal_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template" ADD CONSTRAINT "workflow_template_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_version" ADD CONSTRAINT "workflow_template_version_workflow_template_id_workflow_template_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_version" ADD CONSTRAINT "workflow_template_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_version" ADD CONSTRAINT "workflow_template_version_owner_principal_id_principal_id_fk" FOREIGN KEY ("owner_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_version" ADD CONSTRAINT "workflow_template_version_eval_gate_result_id_eval_gate_result_id_fk" FOREIGN KEY ("eval_gate_result_id") REFERENCES "public"."eval_gate_result"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_version" ADD CONSTRAINT "workflow_template_version_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_request_approval_request_id_key" ON "approval_request" USING btree ("approval_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_request_idempotency_key_key" ON "approval_request" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "approval_request_workflow_run_id_idx" ON "approval_request" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "approval_request_task_id_idx" ON "approval_request" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "approval_request_workflow_step_id_idx" ON "approval_request" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "approval_request_delegation_id_idx" ON "approval_request" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "approval_request_tool_call_id_idx" ON "approval_request" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "approval_request_requester_principal_id_idx" ON "approval_request" USING btree ("requester_principal_id");--> statement-breakpoint
CREATE INDEX "approval_request_approver_principal_id_idx" ON "approval_request" USING btree ("approver_principal_id");--> statement-breakpoint
CREATE INDEX "approval_request_required_role_id_idx" ON "approval_request" USING btree ("required_role_id");--> statement-breakpoint
CREATE INDEX "approval_request_project_state_idx" ON "approval_request" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "approval_request_state_created_at_idx" ON "approval_request" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "approval_request_expires_at_idx" ON "approval_request" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "approval_request_trace_id_idx" ON "approval_request" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "approval_request_request_id_idx" ON "approval_request" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "approval_request_decision_audit_event_id_idx" ON "approval_request" USING btree ("decision_audit_event_id");--> statement-breakpoint
CREATE INDEX "approval_request_budget_scope_id_idx" ON "approval_request" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_lifecycle_event_id_key" ON "artifact_lifecycle_event" USING btree ("artifact_lifecycle_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_lifecycle_event_idempotency_key_key" ON "artifact_lifecycle_event" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "artifact_lifecycle_event_task_artifact_id_idx" ON "artifact_lifecycle_event" USING btree ("task_artifact_id");--> statement-breakpoint
CREATE INDEX "artifact_lifecycle_event_project_id_idx" ON "artifact_lifecycle_event" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "artifact_lifecycle_event_action_created_at_idx" ON "artifact_lifecycle_event" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "artifact_lifecycle_event_state_idx" ON "artifact_lifecycle_event" USING btree ("state");--> statement-breakpoint
CREATE INDEX "artifact_lifecycle_event_expires_at_idx" ON "artifact_lifecycle_event" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "artifact_lifecycle_event_trace_id_idx" ON "artifact_lifecycle_event" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "artifact_lifecycle_event_request_id_idx" ON "artifact_lifecycle_event" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "artifact_lifecycle_event_audit_event_id_idx" ON "artifact_lifecycle_event" USING btree ("audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_review_item_manual_review_item_id_key" ON "manual_review_item" USING btree ("manual_review_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_review_item_idempotency_key_key" ON "manual_review_item" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "manual_review_item_workflow_run_id_idx" ON "manual_review_item" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "manual_review_item_workflow_step_id_idx" ON "manual_review_item" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "manual_review_item_step_attempt_id_idx" ON "manual_review_item" USING btree ("step_attempt_id");--> statement-breakpoint
CREATE INDEX "manual_review_item_delegation_id_idx" ON "manual_review_item" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "manual_review_item_agent_run_id_idx" ON "manual_review_item" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "manual_review_item_tool_call_id_idx" ON "manual_review_item" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "manual_review_item_owner_principal_id_idx" ON "manual_review_item" USING btree ("owner_principal_id");--> statement-breakpoint
CREATE INDEX "manual_review_item_owner_role_id_idx" ON "manual_review_item" USING btree ("owner_role_id");--> statement-breakpoint
CREATE INDEX "manual_review_item_project_review_state_idx" ON "manual_review_item" USING btree ("project_id","review_state");--> statement-breakpoint
CREATE INDEX "manual_review_item_review_state_created_at_idx" ON "manual_review_item" USING btree ("review_state","created_at");--> statement-breakpoint
CREATE INDEX "manual_review_item_trace_id_idx" ON "manual_review_item" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "manual_review_item_request_id_idx" ON "manual_review_item" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "manual_review_item_resolution_audit_event_id_idx" ON "manual_review_item" USING btree ("resolution_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_cancellation_workflow_cancellation_id_key" ON "workflow_cancellation" USING btree ("workflow_cancellation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_cancellation_idempotency_key_key" ON "workflow_cancellation" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "workflow_cancellation_workflow_run_id_idx" ON "workflow_cancellation" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_cancellation_requester_principal_id_idx" ON "workflow_cancellation" USING btree ("requester_principal_id");--> statement-breakpoint
CREATE INDEX "workflow_cancellation_project_id_idx" ON "workflow_cancellation" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_cancellation_propagation_state_idx" ON "workflow_cancellation" USING btree ("propagation_state");--> statement-breakpoint
CREATE INDEX "workflow_cancellation_trace_id_idx" ON "workflow_cancellation" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "workflow_cancellation_request_id_idx" ON "workflow_cancellation" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "workflow_cancellation_audit_event_id_idx" ON "workflow_cancellation" USING btree ("audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_outbox_outbox_id_key" ON "workflow_outbox" USING btree ("outbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_outbox_dest_source_idempotency_key" ON "workflow_outbox" USING btree ("destination_kind","source_workflow_event_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "workflow_outbox_workflow_run_id_idx" ON "workflow_outbox" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_outbox_source_workflow_event_id_idx" ON "workflow_outbox" USING btree ("source_workflow_event_id");--> statement-breakpoint
CREATE INDEX "workflow_outbox_payload_artifact_id_idx" ON "workflow_outbox" USING btree ("payload_artifact_id");--> statement-breakpoint
CREATE INDEX "workflow_outbox_delivery_state_idx" ON "workflow_outbox" USING btree ("delivery_state");--> statement-breakpoint
CREATE INDEX "workflow_outbox_next_attempt_at_idx" ON "workflow_outbox" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "workflow_outbox_project_id_idx" ON "workflow_outbox" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_outbox_trace_id_idx" ON "workflow_outbox" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "workflow_outbox_request_id_idx" ON "workflow_outbox" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_workflow_template_id_key" ON "workflow_template" USING btree ("workflow_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_name_project_key" ON "workflow_template" USING btree ("template_name","project_id");--> statement-breakpoint
CREATE INDEX "workflow_template_owner_principal_id_idx" ON "workflow_template" USING btree ("owner_principal_id");--> statement-breakpoint
CREATE INDEX "workflow_template_project_id_idx" ON "workflow_template" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_template_status_idx" ON "workflow_template" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_version_version_id_key" ON "workflow_template_version" USING btree ("workflow_template_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_version_template_version_key" ON "workflow_template_version" USING btree ("workflow_template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_version_idempotency_key_key" ON "workflow_template_version" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "workflow_template_version_workflow_template_id_idx" ON "workflow_template_version" USING btree ("workflow_template_id");--> statement-breakpoint
CREATE INDEX "workflow_template_version_project_id_idx" ON "workflow_template_version" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_template_version_owner_principal_id_idx" ON "workflow_template_version" USING btree ("owner_principal_id");--> statement-breakpoint
CREATE INDEX "workflow_template_version_eval_gate_result_id_idx" ON "workflow_template_version" USING btree ("eval_gate_result_id");--> statement-breakpoint
CREATE INDEX "workflow_template_version_status_idx" ON "workflow_template_version" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_template_version_created_audit_event_id_idx" ON "workflow_template_version" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_workflow_template_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'workflow_template_version rows are immutable; create a new version instead';
END;
$$;--> statement-breakpoint
CREATE TRIGGER workflow_template_version_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON "workflow_template_version"
FOR EACH STATEMENT
EXECUTE FUNCTION reject_workflow_template_version_mutation();--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_template_version_id_workflow_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."workflow_template_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_run_template_version_id_idx" ON "workflow_run" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "workflow_step_next_attempt_at_idx" ON "workflow_step" USING btree ("next_attempt_at");--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_replay_decision_check" CHECK ("step_attempt"."replay_decision" IS NULL OR "step_attempt"."replay_decision" IN ('replay', 'skip', 'abort'));--> statement-breakpoint
ALTER TABLE "step_attempt" ADD CONSTRAINT "step_attempt_failure_class_check" CHECK ("step_attempt"."failure_class" IS NULL OR "step_attempt"."failure_class" IN ('transient_timeout_before_accept', 'provider_request_id_returned_commit_failed', 'tool_adapter_transient', 'validation_failure', 'budget_denial', 'policy_denial', 'non_idempotent_unknown_side_effect', 'worker_crash_active_lease'));--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_type_check" CHECK ("workflow_event"."event_type" IN ('workflow_created', 'state_transitioned', 'workflow_state_changed', 'step_created', 'step_state_changed', 'agent_run_started', 'delegation_created', 'delegation_completed', 'delegation_state_changed', 'tool_call_decided', 'agent_run_state_changed', 'tool_call_state_changed', 'artifact_recorded', 'budget_recorded', 'budget_reserved', 'cost_recorded', 'audit_recorded', 'heartbeat', 'lease_acquired', 'lease_released', 'workflow_completed', 'workflow_failed', 'error', 'cancel_requested', 'approval_requested', 'approval_approved', 'approval_denied', 'approval_expired', 'retry_scheduled', 'retry_executed', 'retry_exhausted', 'outbox_enqueued', 'outbox_delivered', 'outbox_failed', 'cancellation_observed', 'cancellation_completed', 'manual_review_opened', 'manual_review_resolved', 'artifact_lifecycle_changed', 'template_instantiated'));--> statement-breakpoint
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_state_check" CHECK ("workflow_event"."state" IS NULL OR "workflow_event"."state" IN ('created', 'draft', 'queued', 'planning', 'delegating', 'dispatched', 'leased', 'running', 'waiting', 'waiting_on_child', 'synthesizing', 'pending_approval', 'manual_review', 'succeeded', 'completed', 'failed', 'authorized', 'denied', 'invalid_output', 'skipped', 'cancel_requested', 'cancelled', 'timed_out', 'retry_scheduled'));--> statement-breakpoint
ALTER TABLE "workflow_idempotency_key" ADD CONSTRAINT "workflow_idempotency_key_operation_check" CHECK ("workflow_idempotency_key"."operation" IN ('workflow_create', 'step_execute', 'delegation_create', 'agent_run', 'model_call', 'tool_call', 'budget_reservation', 'cost_event', 'audit_event', 'artifact_write', 'skill_register', 'skill_version_register', 'approval', 'outbox', 'cancellation', 'retry', 'manual_review', 'reservation_release', 'artifact_lifecycle', 'template_instantiation'));--> statement-breakpoint
ALTER TABLE "workflow_lease" ADD CONSTRAINT "workflow_lease_manual_review_status_check" CHECK ("workflow_lease"."manual_review_status" IS NULL OR "workflow_lease"."manual_review_status" IN ('pending', 'in_review', 'approved', 'rejected', 'escalated'));--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_pause_state_check" CHECK ("workflow_run"."pause_state" IS NULL OR "workflow_run"."pause_state" IN ('pause_requested', 'paused', 'resume_requested'));--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_manual_review_status_check" CHECK ("workflow_run"."manual_review_status" IS NULL OR "workflow_run"."manual_review_status" IN ('pending', 'in_review', 'approved', 'rejected', 'escalated'));--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_state_check" CHECK ("workflow_run"."state" IN ('created', 'queued', 'planning', 'delegating', 'running', 'waiting_on_child', 'synthesizing', 'pending_approval', 'manual_review', 'succeeded', 'completed', 'failed', 'cancel_requested', 'cancelled', 'timed_out', 'denied'));--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_failure_class_check" CHECK ("workflow_step"."failure_class" IS NULL OR "workflow_step"."failure_class" IN ('transient_timeout_before_accept', 'provider_request_id_returned_commit_failed', 'tool_adapter_transient', 'validation_failure', 'budget_denial', 'policy_denial', 'non_idempotent_unknown_side_effect', 'worker_crash_active_lease'));--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_step_type_check" CHECK ("workflow_step"."step_type" IN ('plan', 'delegate', 'agent', 'tool', 'synthesize', 'review', 'artifact', 'approval_gate'));--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_state_check" CHECK ("workflow_step"."state" IN ('created', 'planning', 'delegating', 'running', 'synthesizing', 'pending_approval', 'manual_review', 'completed', 'failed', 'skipped', 'cancel_requested', 'cancelled', 'timed_out'));