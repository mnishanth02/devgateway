CREATE TABLE "audit_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"audit_event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"decision" text,
	"reason" text,
	"actor_principal_id" bigint,
	"target_principal_id" bigint,
	"project_id" bigint,
	"virtual_key_id" bigint,
	"budget_scope_id" bigint,
	"auth_user_id" text,
	"trace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"span_id" text,
	"policy_version" text,
	"registry_version" text,
	"environment" text DEFAULT 'development' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_outcome_check" CHECK ("audit_event"."outcome" IN ('allow', 'deny', 'success', 'failure', 'error')),
	CONSTRAINT "audit_event_decision_check" CHECK ("audit_event"."decision" IS NULL OR "audit_event"."decision" IN ('allow', 'deny')),
	CONSTRAINT "audit_event_environment_check" CHECK ("audit_event"."environment" IN ('development', 'staging', 'production', 'test'))
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"internal_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "auth_account_internal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_account_id" text,
	"password_hash" text,
	"access_token_ciphertext" text,
	"access_token_key_id" text,
	"access_token_algorithm" text,
	"access_token_nonce" text,
	"refresh_token_ciphertext" text,
	"refresh_token_key_id" text,
	"refresh_token_algorithm" text,
	"refresh_token_nonce" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token_ciphertext" text,
	"id_token_key_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"internal_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "auth_session_internal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_two_factor" (
	"internal_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "auth_two_factor_internal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_key_id" text,
	"secret_algorithm" text,
	"secret_nonce" text,
	"backup_code_ciphertext" text,
	"backup_code_key_id" text,
	"backup_code_algorithm" text,
	"backup_code_nonce" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_two_factor_status_check" CHECK ("auth_two_factor"."status" IN ('pending', 'verified', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"internal_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "auth_user_internal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_status_check" CHECK ("auth_user"."status" IN ('invited', 'active', 'disabled', 'deleted')),
	CONSTRAINT "auth_user_production_enabled_false" CHECK ("auth_user"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"internal_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "auth_verification_internal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_glass_activation" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "break_glass_activation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"break_glass_activation_id" text NOT NULL,
	"project_id" bigint NOT NULL,
	"requested_by_principal_id" bigint NOT NULL,
	"approved_by_principal_id" bigint,
	"activated_by_principal_id" bigint,
	"status" text DEFAULT 'requested' NOT NULL,
	"environment" text DEFAULT 'development' NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text,
	"token_ciphertext" text,
	"token_key_id" text,
	"token_algorithm" text,
	"token_nonce" text,
	"token_fingerprint" text,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_audit_event_id" bigint,
	"activated_audit_event_id" bigint,
	"revoked_audit_event_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "break_glass_activation_status_check" CHECK ("break_glass_activation"."status" IN ('requested', 'approved', 'activated', 'denied', 'revoked', 'expired')),
	CONSTRAINT "break_glass_activation_environment_check" CHECK ("break_glass_activation"."environment" IN ('development', 'staging', 'production', 'test')),
	CONSTRAINT "break_glass_activation_production_enabled_false" CHECK ("break_glass_activation"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "budget_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "budget_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ledger_entry_id" text NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"cost_event_id" bigint,
	"entry_type" text NOT NULL,
	"amount" numeric(20, 8),
	"currency" text NOT NULL,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"total_tokens" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"reset_period_start" timestamp with time zone NOT NULL,
	"reset_period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_ledger_entry_type_check" CHECK ("budget_ledger"."entry_type" IN ('reservation', 'reservation_release', 'actual', 'adjustment')),
	CONSTRAINT "budget_ledger_status_check" CHECK ("budget_ledger"."status" IN ('pending', 'committed', 'released', 'voided'))
);
--> statement-breakpoint
CREATE TABLE "budget_policy" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "budget_policy_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"budget_policy_id" text NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"currency" text NOT NULL,
	"hard_cap_amount" numeric(20, 8),
	"soft_cap_amount" numeric(20, 8),
	"token_cap_input" bigint,
	"token_cap_output" bigint,
	"token_cap_total" bigint,
	"reset_period" text NOT NULL,
	"reset_anchor" timestamp with time zone,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"policy_version" text NOT NULL,
	"created_audit_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_policy_reset_period_check" CHECK ("budget_policy"."reset_period" IN ('daily', 'weekly', 'monthly', 'rolling_24h', 'rolling_7d', 'rolling_30d', 'none')),
	CONSTRAINT "budget_policy_currency_check" CHECK ("budget_policy"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "budget_policy_production_enabled_false" CHECK ("budget_policy"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "budget_scope" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "budget_scope_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"budget_scope_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"owner_ref" text NOT NULL,
	"org_id" bigint,
	"team_id" bigint,
	"project_id" bigint,
	"principal_id" bigint,
	"virtual_key_id" bigint,
	"parent_budget_scope_id" bigint,
	"status" text DEFAULT 'draft' NOT NULL,
	"policy_version" text NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_scope_scope_type_check" CHECK ("budget_scope"."scope_type" IN ('org', 'team', 'project', 'principal', 'virtual_key')),
	CONSTRAINT "budget_scope_status_check" CHECK ("budget_scope"."status" IN ('draft', 'active', 'disabled', 'archived')),
	CONSTRAINT "budget_scope_production_enabled_false" CHECK ("budget_scope"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "cost_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cost_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"cost_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"span_id" text,
	"principal_id" bigint,
	"project_id" bigint NOT NULL,
	"virtual_key_id" bigint,
	"budget_scope_id" bigint NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"environment" text DEFAULT 'development' NOT NULL,
	"route_intent" text NOT NULL,
	"data_class" text NOT NULL,
	"provider" text,
	"model_alias" text NOT NULL,
	"provider_model_id" text,
	"gateway_attempt" integer DEFAULT 1 NOT NULL,
	"fallback_attempt" integer DEFAULT 0 NOT NULL,
	"attempt_status" text NOT NULL,
	"currency" text NOT NULL,
	"estimated_input_tokens" bigint,
	"estimated_output_tokens" bigint,
	"estimated_total_tokens" bigint,
	"estimated_cost_amount" numeric(20, 8),
	"actual_input_tokens" bigint,
	"actual_output_tokens" bigint,
	"actual_total_tokens" bigint,
	"actual_cost_amount" numeric(20, 8),
	"usage_source" text NOT NULL,
	"decision" text NOT NULL,
	"denial_reason" text,
	"budget_reservation_ledger_id" bigint,
	"audit_event_id" bigint,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_event_event_type_check" CHECK ("cost_event"."event_type" IN ('estimate', 'actual', 'reconciliation', 'denial_estimate')),
	CONSTRAINT "cost_event_attempt_status_check" CHECK ("cost_event"."attempt_status" IN ('started', 'succeeded', 'failed', 'denied', 'cancelled', 'timed_out')),
	CONSTRAINT "cost_event_usage_source_check" CHECK ("cost_event"."usage_source" IN ('registry_estimate', 'gateway_counter', 'provider_reported', 'estimated_final', 'not_available')),
	CONSTRAINT "cost_event_decision_check" CHECK ("cost_event"."decision" IN ('allow', 'deny')),
	CONSTRAINT "cost_event_denial_reason_check" CHECK ("cost_event"."decision" <> 'deny' OR "cost_event"."denial_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "eval_gate_result" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "eval_gate_result_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"gate_result_id" text NOT NULL,
	"change_id" text NOT NULL,
	"dataset_version" text NOT NULL,
	"eval_suite_version" text NOT NULL,
	"runner_version" text NOT NULL,
	"target_kind" text NOT NULL,
	"artifact_version" text NOT NULL,
	"model_alias" text,
	"provider" text,
	"retrieval_strategy_id" text,
	"prompt_template_id" text,
	"tool_name" text,
	"skill_id" text,
	"index_id" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pass" boolean NOT NULL,
	"blocking_severity" text NOT NULL,
	"owner_approval_required" boolean DEFAULT false NOT NULL,
	"reviewer_principal_id" bigint,
	"reviewed_at" timestamp with time zone,
	"approver_principal_id" bigint,
	"approved_at" timestamp with time zone,
	"approval_reason" text,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifact_storage_policy_ref" text NOT NULL,
	"retention_policy_ref" text NOT NULL,
	"audit_event_id" bigint NOT NULL,
	"trace_id" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_gate_result_target_kind_check" CHECK ("eval_gate_result"."target_kind" IN ('model_alias', 'fallback_route', 'tool', 'prompt_template', 'retrieval_strategy', 'skill', 'index_version')),
	CONSTRAINT "eval_gate_result_blocking_severity_check" CHECK ("eval_gate_result"."blocking_severity" IN ('none', 'low', 'medium', 'high', 'critical')),
	CONSTRAINT "eval_gate_result_pass_requires_no_blocking_severity" CHECK ("eval_gate_result"."pass" = false OR "eval_gate_result"."blocking_severity" = 'none'),
	CONSTRAINT "eval_gate_result_owner_approval_requires_approver" CHECK ("eval_gate_result"."owner_approval_required" = false OR "eval_gate_result"."approver_principal_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "model_alias_snapshot" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "model_alias_snapshot_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"model_alias_snapshot_id" text NOT NULL,
	"model_alias" text NOT NULL,
	"provider_snapshot_id" bigint,
	"provider" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"registry_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"routing_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gate_result_id" text,
	"created_audit_event_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_alias_snapshot_status_check" CHECK ("model_alias_snapshot"."status" IN ('draft', 'active', 'disabled', 'archived')),
	CONSTRAINT "model_alias_snapshot_production_enabled_false" CHECK ("model_alias_snapshot"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "org" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "org_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_status_check" CHECK ("org"."status" IN ('draft', 'active', 'disabled', 'archived')),
	CONSTRAINT "org_production_enabled_false" CHECK ("org"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "permission_grant" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "permission_grant_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"permission_grant_id" text NOT NULL,
	"principal_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	"org_id" bigint,
	"team_id" bigint,
	"project_id" bigint,
	"resource_type" text,
	"resource_ref" text,
	"permission" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_grant_status_check" CHECK ("permission_grant"."status" IN ('active', 'revoked', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "policy_snapshot" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "policy_snapshot_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"policy_snapshot_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"checksum" text NOT NULL,
	"policy_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_audit_event_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_snapshot_status_check" CHECK ("policy_snapshot"."status" IN ('draft', 'active', 'disabled', 'archived')),
	CONSTRAINT "policy_snapshot_production_enabled_false" CHECK ("policy_snapshot"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "principal" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "principal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"principal_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"org_id" bigint,
	"auth_user_id" text,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principal_type_check" CHECK ("principal"."principal_type" IN ('user', 'service', 'system')),
	CONSTRAINT "principal_status_check" CHECK ("principal"."status" IN ('active', 'disabled', 'archived')),
	CONSTRAINT "principal_production_enabled_false" CHECK ("principal"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" text NOT NULL,
	"org_id" bigint NOT NULL,
	"team_id" bigint,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"environment" text DEFAULT 'development' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_environment_check" CHECK ("project"."environment" IN ('development', 'staging', 'production', 'test')),
	CONSTRAINT "project_status_check" CHECK ("project"."status" IN ('draft', 'active', 'disabled', 'archived')),
	CONSTRAINT "project_production_enabled_false" CHECK ("project"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "provider_snapshot" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "provider_snapshot_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider_snapshot_id" text NOT NULL,
	"provider" text NOT NULL,
	"registry_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"environment" text DEFAULT 'development' NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"config_checksum" text NOT NULL,
	"provider_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_key_ciphertext" text,
	"provider_key_id" text,
	"provider_key_algorithm" text,
	"provider_key_nonce" text,
	"provider_key_fingerprint" text,
	"created_audit_event_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_snapshot_status_check" CHECK ("provider_snapshot"."status" IN ('draft', 'active', 'disabled', 'archived')),
	CONSTRAINT "provider_snapshot_environment_check" CHECK ("provider_snapshot"."environment" IN ('development', 'staging', 'production', 'test')),
	CONSTRAINT "provider_snapshot_production_enabled_false" CHECK ("provider_snapshot"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "request_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_log_id" text NOT NULL,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"span_id" text,
	"parent_span_id" text,
	"principal_id" bigint,
	"project_id" bigint,
	"virtual_key_id" bigint,
	"budget_scope_id" bigint,
	"cost_event_id" bigint,
	"audit_event_id" bigint,
	"environment" text DEFAULT 'development' NOT NULL,
	"route_intent" text NOT NULL,
	"data_class" text NOT NULL,
	"provider" text,
	"model_alias" text,
	"provider_model_id" text,
	"gateway_attempt" integer DEFAULT 1 NOT NULL,
	"fallback_attempt" integer DEFAULT 0 NOT NULL,
	"decision" text NOT NULL,
	"denial_reason" text,
	"status_code" integer,
	"latency_ms" integer,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_log_decision_check" CHECK ("request_log"."decision" IN ('allow', 'deny')),
	CONSTRAINT "request_log_environment_check" CHECK ("request_log"."environment" IN ('development', 'staging', 'production', 'test'))
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "role_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"role_id" text NOT NULL,
	"org_id" bigint,
	"name" text NOT NULL,
	"scope_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_scope_type_check" CHECK ("role"."scope_type" IN ('system', 'org', 'team', 'project')),
	CONSTRAINT "role_status_check" CHECK ("role"."status" IN ('active', 'disabled', 'archived')),
	CONSTRAINT "role_production_enabled_false" CHECK ("role"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "team_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"team_id" text NOT NULL,
	"org_id" bigint NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_status_check" CHECK ("team"."status" IN ('draft', 'active', 'disabled', 'archived')),
	CONSTRAINT "team_production_enabled_false" CHECK ("team"."production_enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "virtual_key" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "virtual_key_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"virtual_key_id" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"key_hash" text NOT NULL,
	"principal_id" bigint NOT NULL,
	"principal_type" text NOT NULL,
	"project_id" bigint NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"environment" text DEFAULT 'development' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scope_constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"not_before" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"rotation_of_key_id" bigint,
	"rotated_to_key_id" bigint,
	"revoked_at" timestamp with time zone,
	"revoked_by_principal_id" bigint,
	"revocation_reason" text,
	"last_used_at" timestamp with time zone,
	"last_used_request_id" text,
	"last_used_trace_id" text,
	"created_audit_event_id" bigint,
	"revoked_audit_event_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "virtual_key_principal_type_check" CHECK ("virtual_key"."principal_type" IN ('user', 'service', 'system')),
	CONSTRAINT "virtual_key_environment_check" CHECK ("virtual_key"."environment" IN ('development', 'staging', 'production', 'test')),
	CONSTRAINT "virtual_key_status_check" CHECK ("virtual_key"."status" IN ('draft', 'active', 'rotating', 'revoked', 'expired', 'disabled')),
	CONSTRAINT "virtual_key_production_enabled_false" CHECK ("virtual_key"."production_enabled" = false),
	CONSTRAINT "virtual_key_revoked_requires_fields" CHECK ("virtual_key"."status" <> 'revoked' OR ("virtual_key"."revoked_at" IS NOT NULL AND "virtual_key"."revoked_by_principal_id" IS NOT NULL AND "virtual_key"."revocation_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_principal_id_principal_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_target_principal_id_principal_id_fk" FOREIGN KEY ("target_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_virtual_key_id_virtual_key_id_fk" FOREIGN KEY ("virtual_key_id") REFERENCES "public"."virtual_key"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_auth_user_id_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_activation" ADD CONSTRAINT "break_glass_activation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_activation" ADD CONSTRAINT "break_glass_activation_requested_by_principal_id_principal_id_fk" FOREIGN KEY ("requested_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_activation" ADD CONSTRAINT "break_glass_activation_approved_by_principal_id_principal_id_fk" FOREIGN KEY ("approved_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_activation" ADD CONSTRAINT "break_glass_activation_activated_by_principal_id_principal_id_fk" FOREIGN KEY ("activated_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_activation" ADD CONSTRAINT "break_glass_activation_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_activation" ADD CONSTRAINT "break_glass_activation_activated_audit_event_id_audit_event_id_fk" FOREIGN KEY ("activated_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_activation" ADD CONSTRAINT "break_glass_activation_revoked_audit_event_id_audit_event_id_fk" FOREIGN KEY ("revoked_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_ledger" ADD CONSTRAINT "budget_ledger_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_ledger" ADD CONSTRAINT "budget_ledger_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policy" ADD CONSTRAINT "budget_policy_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policy" ADD CONSTRAINT "budget_policy_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scope" ADD CONSTRAINT "budget_scope_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scope" ADD CONSTRAINT "budget_scope_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scope" ADD CONSTRAINT "budget_scope_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scope" ADD CONSTRAINT "budget_scope_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scope" ADD CONSTRAINT "budget_scope_virtual_key_id_virtual_key_id_fk" FOREIGN KEY ("virtual_key_id") REFERENCES "public"."virtual_key"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scope" ADD CONSTRAINT "budget_scope_parent_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("parent_budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_virtual_key_id_virtual_key_id_fk" FOREIGN KEY ("virtual_key_id") REFERENCES "public"."virtual_key"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_budget_reservation_ledger_id_budget_ledger_id_fk" FOREIGN KEY ("budget_reservation_ledger_id") REFERENCES "public"."budget_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_gate_result" ADD CONSTRAINT "eval_gate_result_reviewer_principal_id_principal_id_fk" FOREIGN KEY ("reviewer_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_gate_result" ADD CONSTRAINT "eval_gate_result_approver_principal_id_principal_id_fk" FOREIGN KEY ("approver_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_gate_result" ADD CONSTRAINT "eval_gate_result_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_alias_snapshot" ADD CONSTRAINT "model_alias_snapshot_provider_snapshot_id_provider_snapshot_id_fk" FOREIGN KEY ("provider_snapshot_id") REFERENCES "public"."provider_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_alias_snapshot" ADD CONSTRAINT "model_alias_snapshot_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_snapshot" ADD CONSTRAINT "policy_snapshot_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal" ADD CONSTRAINT "principal_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal" ADD CONSTRAINT "principal_auth_user_id_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_snapshot" ADD CONSTRAINT "provider_snapshot_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_virtual_key_id_virtual_key_id_fk" FOREIGN KEY ("virtual_key_id") REFERENCES "public"."virtual_key"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_audit_event_id_audit_event_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_key" ADD CONSTRAINT "virtual_key_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_key" ADD CONSTRAINT "virtual_key_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_key" ADD CONSTRAINT "virtual_key_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_key" ADD CONSTRAINT "virtual_key_rotation_of_key_id_virtual_key_id_fk" FOREIGN KEY ("rotation_of_key_id") REFERENCES "public"."virtual_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_key" ADD CONSTRAINT "virtual_key_rotated_to_key_id_virtual_key_id_fk" FOREIGN KEY ("rotated_to_key_id") REFERENCES "public"."virtual_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_key" ADD CONSTRAINT "virtual_key_revoked_by_principal_id_principal_id_fk" FOREIGN KEY ("revoked_by_principal_id") REFERENCES "public"."principal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_key" ADD CONSTRAINT "virtual_key_created_audit_event_id_audit_event_id_fk" FOREIGN KEY ("created_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_key" ADD CONSTRAINT "virtual_key_revoked_audit_event_id_audit_event_id_fk" FOREIGN KEY ("revoked_audit_event_id") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_event_audit_event_id_key" ON "audit_event" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "audit_event_actor_principal_id_idx" ON "audit_event" USING btree ("actor_principal_id");--> statement-breakpoint
CREATE INDEX "audit_event_target_principal_id_idx" ON "audit_event" USING btree ("target_principal_id");--> statement-breakpoint
CREATE INDEX "audit_event_project_id_created_at_idx" ON "audit_event" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_virtual_key_id_idx" ON "audit_event" USING btree ("virtual_key_id");--> statement-breakpoint
CREATE INDEX "audit_event_budget_scope_id_idx" ON "audit_event" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "audit_event_auth_user_id_idx" ON "audit_event" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "audit_event_trace_id_idx" ON "audit_event" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "audit_event_request_id_idx" ON "audit_event" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "audit_event_policy_registry_idx" ON "audit_event" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_internal_id_key" ON "auth_account" USING btree ("internal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_account_id_key" ON "auth_account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_account_key" ON "auth_account" USING btree ("provider_id","provider_account_id");--> statement-breakpoint
CREATE INDEX "auth_account_user_id_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_internal_id_key" ON "auth_session" USING btree ("internal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_token_key" ON "auth_session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_session_user_id_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_two_factor_internal_id_key" ON "auth_two_factor" USING btree ("internal_id");--> statement-breakpoint
CREATE INDEX "auth_two_factor_user_id_idx" ON "auth_two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_user_internal_id_key" ON "auth_user" USING btree ("internal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_user_email_key" ON "auth_user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_verification_internal_id_key" ON "auth_verification" USING btree ("internal_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "auth_verification_expires_at_idx" ON "auth_verification" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "break_glass_activation_id_key" ON "break_glass_activation" USING btree ("break_glass_activation_id");--> statement-breakpoint
CREATE INDEX "break_glass_activation_project_id_idx" ON "break_glass_activation" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "break_glass_activation_requested_by_idx" ON "break_glass_activation" USING btree ("requested_by_principal_id");--> statement-breakpoint
CREATE INDEX "break_glass_activation_approved_by_idx" ON "break_glass_activation" USING btree ("approved_by_principal_id");--> statement-breakpoint
CREATE INDEX "break_glass_activation_activated_by_idx" ON "break_glass_activation" USING btree ("activated_by_principal_id");--> statement-breakpoint
CREATE INDEX "break_glass_activation_created_audit_event_id_idx" ON "break_glass_activation" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE INDEX "break_glass_activation_activated_audit_event_id_idx" ON "break_glass_activation" USING btree ("activated_audit_event_id");--> statement-breakpoint
CREATE INDEX "break_glass_activation_revoked_audit_event_id_idx" ON "break_glass_activation" USING btree ("revoked_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_ledger_ledger_entry_id_key" ON "budget_ledger" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "budget_ledger_budget_scope_window_idx" ON "budget_ledger" USING btree ("budget_scope_id","reset_period_start","reset_period_end");--> statement-breakpoint
CREATE INDEX "budget_ledger_request_id_idx" ON "budget_ledger" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "budget_ledger_trace_id_idx" ON "budget_ledger" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "budget_ledger_cost_event_id_idx" ON "budget_ledger" USING btree ("cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_policy_budget_policy_id_key" ON "budget_policy" USING btree ("budget_policy_id");--> statement-breakpoint
CREATE INDEX "budget_policy_budget_scope_effective_from_idx" ON "budget_policy" USING btree ("budget_scope_id","effective_from");--> statement-breakpoint
CREATE INDEX "budget_policy_created_audit_event_id_idx" ON "budget_policy" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_scope_budget_scope_id_key" ON "budget_scope" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "budget_scope_scope_type_owner_ref_idx" ON "budget_scope" USING btree ("scope_type","owner_ref");--> statement-breakpoint
CREATE INDEX "budget_scope_org_id_idx" ON "budget_scope" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "budget_scope_team_id_idx" ON "budget_scope" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "budget_scope_project_id_idx" ON "budget_scope" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "budget_scope_principal_id_idx" ON "budget_scope" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "budget_scope_virtual_key_id_idx" ON "budget_scope" USING btree ("virtual_key_id");--> statement-breakpoint
CREATE INDEX "budget_scope_parent_budget_scope_id_idx" ON "budget_scope" USING btree ("parent_budget_scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_event_cost_event_id_key" ON "cost_event" USING btree ("cost_event_id");--> statement-breakpoint
CREATE INDEX "cost_event_budget_scope_created_at_idx" ON "cost_event" USING btree ("budget_scope_id","created_at");--> statement-breakpoint
CREATE INDEX "cost_event_project_created_at_idx" ON "cost_event" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "cost_event_virtual_key_created_at_idx" ON "cost_event" USING btree ("virtual_key_id","created_at");--> statement-breakpoint
CREATE INDEX "cost_event_provider_model_created_at_idx" ON "cost_event" USING btree ("provider","model_alias","created_at");--> statement-breakpoint
CREATE INDEX "cost_event_request_id_idx" ON "cost_event" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "cost_event_trace_id_idx" ON "cost_event" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "cost_event_policy_registry_idx" ON "cost_event" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "cost_event_environment_route_data_idx" ON "cost_event" USING btree ("environment","route_intent","data_class");--> statement-breakpoint
CREATE INDEX "cost_event_principal_id_idx" ON "cost_event" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "cost_event_budget_reservation_ledger_id_idx" ON "cost_event" USING btree ("budget_reservation_ledger_id");--> statement-breakpoint
CREATE INDEX "cost_event_audit_event_id_idx" ON "cost_event" USING btree ("audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_gate_result_gate_result_id_key" ON "eval_gate_result" USING btree ("gate_result_id");--> statement-breakpoint
CREATE INDEX "eval_gate_result_match_key_idx" ON "eval_gate_result" USING btree ("change_id","dataset_version","eval_suite_version","artifact_version");--> statement-breakpoint
CREATE INDEX "eval_gate_result_audit_event_id_idx" ON "eval_gate_result" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "eval_gate_result_reviewer_principal_id_idx" ON "eval_gate_result" USING btree ("reviewer_principal_id");--> statement-breakpoint
CREATE INDEX "eval_gate_result_approver_principal_id_idx" ON "eval_gate_result" USING btree ("approver_principal_id");--> statement-breakpoint
CREATE INDEX "eval_gate_result_trace_id_idx" ON "eval_gate_result" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "eval_gate_result_request_id_idx" ON "eval_gate_result" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_alias_snapshot_model_alias_snapshot_id_key" ON "model_alias_snapshot" USING btree ("model_alias_snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_alias_snapshot_alias_registry_key" ON "model_alias_snapshot" USING btree ("model_alias","registry_version","provider");--> statement-breakpoint
CREATE INDEX "model_alias_snapshot_provider_snapshot_id_idx" ON "model_alias_snapshot" USING btree ("provider_snapshot_id");--> statement-breakpoint
CREATE INDEX "model_alias_snapshot_policy_version_idx" ON "model_alias_snapshot" USING btree ("policy_version");--> statement-breakpoint
CREATE INDEX "model_alias_snapshot_created_audit_event_id_idx" ON "model_alias_snapshot" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_org_id_key" ON "org" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_slug_key" ON "org" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grant_permission_grant_id_key" ON "permission_grant" USING btree ("permission_grant_id");--> statement-breakpoint
CREATE INDEX "permission_grant_principal_id_idx" ON "permission_grant" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "permission_grant_role_id_idx" ON "permission_grant" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "permission_grant_org_id_idx" ON "permission_grant" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "permission_grant_team_id_idx" ON "permission_grant" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "permission_grant_project_id_idx" ON "permission_grant" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_snapshot_policy_snapshot_id_key" ON "policy_snapshot" USING btree ("policy_snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_snapshot_policy_version_key" ON "policy_snapshot" USING btree ("policy_version");--> statement-breakpoint
CREATE INDEX "policy_snapshot_created_audit_event_id_idx" ON "policy_snapshot" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_principal_id_key" ON "principal" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "principal_org_id_idx" ON "principal" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "principal_auth_user_id_idx" ON "principal" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_project_id_key" ON "project" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_slug_key" ON "project" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "project_org_id_idx" ON "project" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "project_team_id_idx" ON "project" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_snapshot_provider_snapshot_id_key" ON "provider_snapshot" USING btree ("provider_snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_snapshot_provider_registry_key" ON "provider_snapshot" USING btree ("provider","registry_version","environment");--> statement-breakpoint
CREATE INDEX "provider_snapshot_policy_version_idx" ON "provider_snapshot" USING btree ("policy_version");--> statement-breakpoint
CREATE INDEX "provider_snapshot_created_audit_event_id_idx" ON "provider_snapshot" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_log_request_log_id_key" ON "request_log" USING btree ("request_log_id");--> statement-breakpoint
CREATE INDEX "request_log_request_id_idx" ON "request_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_log_trace_id_idx" ON "request_log" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "request_log_principal_created_at_idx" ON "request_log" USING btree ("principal_id","created_at");--> statement-breakpoint
CREATE INDEX "request_log_project_created_at_idx" ON "request_log" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "request_log_virtual_key_created_at_idx" ON "request_log" USING btree ("virtual_key_id","created_at");--> statement-breakpoint
CREATE INDEX "request_log_budget_scope_created_at_idx" ON "request_log" USING btree ("budget_scope_id","created_at");--> statement-breakpoint
CREATE INDEX "request_log_cost_event_id_idx" ON "request_log" USING btree ("cost_event_id");--> statement-breakpoint
CREATE INDEX "request_log_audit_event_id_idx" ON "request_log" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "request_log_policy_registry_idx" ON "request_log" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE UNIQUE INDEX "role_role_id_key" ON "role" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_org_name_key" ON "role" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "role_org_id_idx" ON "role" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_team_id_key" ON "team" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_org_slug_key" ON "team" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "team_org_id_idx" ON "team" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_key_virtual_key_id_key" ON "virtual_key" USING btree ("virtual_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_key_key_fingerprint_key" ON "virtual_key" USING btree ("key_fingerprint");--> statement-breakpoint
CREATE INDEX "virtual_key_principal_project_status_idx" ON "virtual_key" USING btree ("principal_id","project_id","status");--> statement-breakpoint
CREATE INDEX "virtual_key_project_status_idx" ON "virtual_key" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "virtual_key_budget_scope_id_idx" ON "virtual_key" USING btree ("budget_scope_id");--> statement-breakpoint
CREATE INDEX "virtual_key_expires_at_idx" ON "virtual_key" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "virtual_key_policy_version_idx" ON "virtual_key" USING btree ("policy_version");--> statement-breakpoint
CREATE INDEX "virtual_key_registry_version_idx" ON "virtual_key" USING btree ("registry_version");--> statement-breakpoint
CREATE INDEX "virtual_key_rotation_of_key_id_idx" ON "virtual_key" USING btree ("rotation_of_key_id");--> statement-breakpoint
CREATE INDEX "virtual_key_rotated_to_key_id_idx" ON "virtual_key" USING btree ("rotated_to_key_id");--> statement-breakpoint
CREATE INDEX "virtual_key_revoked_by_principal_id_idx" ON "virtual_key" USING btree ("revoked_by_principal_id");--> statement-breakpoint
CREATE INDEX "virtual_key_created_audit_event_id_idx" ON "virtual_key" USING btree ("created_audit_event_id");--> statement-breakpoint
CREATE INDEX "virtual_key_revoked_audit_event_id_idx" ON "virtual_key" USING btree ("revoked_audit_event_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_update_delete_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table % rejects %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_event
FOR EACH STATEMENT EXECUTE FUNCTION reject_update_delete_append_only();--> statement-breakpoint
CREATE TRIGGER eval_gate_result_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON eval_gate_result
FOR EACH STATEMENT EXECUTE FUNCTION reject_update_delete_append_only();