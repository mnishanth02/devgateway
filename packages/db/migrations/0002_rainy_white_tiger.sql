CREATE TABLE "budget_reservation" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "budget_reservation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"reservation_id" text NOT NULL,
	"budget_scope_id" bigint NOT NULL,
	"workflow_run_id" bigint,
	"delegation_id" bigint,
	"tool_class" text,
	"model_alias" text,
	"currency" text NOT NULL,
	"reserved_amount" numeric(20, 8) NOT NULL,
	"actual_amount" numeric(20, 8),
	"reserved_input_tokens" bigint,
	"reserved_output_tokens" bigint,
	"reserved_total_tokens" bigint,
	"actual_input_tokens" bigint,
	"actual_output_tokens" bigint,
	"actual_total_tokens" bigint,
	"status" text DEFAULT 'reserved' NOT NULL,
	"reserve_idempotency_key" text NOT NULL,
	"settle_idempotency_key" text,
	"release_idempotency_key" text,
	"request_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"registry_version" text,
	"cost_event_id" bigint,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_reservation_status_check" CHECK ("budget_reservation"."status" IN ('reserved', 'settled', 'released')),
	CONSTRAINT "budget_reservation_currency_check" CHECK ("budget_reservation"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "budget_reservation_production_enabled_false" CHECK ("budget_reservation"."production_enabled" = false)
);
--> statement-breakpoint
ALTER TABLE "budget_reservation" ADD CONSTRAINT "budget_reservation_budget_scope_id_budget_scope_id_fk" FOREIGN KEY ("budget_scope_id") REFERENCES "public"."budget_scope"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation" ADD CONSTRAINT "budget_reservation_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation" ADD CONSTRAINT "budget_reservation_delegation_id_delegation_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation" ADD CONSTRAINT "budget_reservation_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_reservation_reservation_id_key" ON "budget_reservation" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_reservation_reserve_idempotency_key_key" ON "budget_reservation" USING btree ("reserve_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_reservation_settle_idempotency_key_key" ON "budget_reservation" USING btree ("settle_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_reservation_release_idempotency_key_key" ON "budget_reservation" USING btree ("release_idempotency_key");--> statement-breakpoint
CREATE INDEX "budget_reservation_budget_scope_status_idx" ON "budget_reservation" USING btree ("budget_scope_id","status");--> statement-breakpoint
CREATE INDEX "budget_reservation_workflow_run_id_idx" ON "budget_reservation" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "budget_reservation_delegation_id_idx" ON "budget_reservation" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "budget_reservation_tool_class_created_at_idx" ON "budget_reservation" USING btree ("tool_class","created_at");--> statement-breakpoint
CREATE INDEX "budget_reservation_model_alias_created_at_idx" ON "budget_reservation" USING btree ("model_alias","created_at");--> statement-breakpoint
CREATE INDEX "budget_reservation_request_id_idx" ON "budget_reservation" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "budget_reservation_trace_id_idx" ON "budget_reservation" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "budget_reservation_policy_registry_idx" ON "budget_reservation" USING btree ("policy_version","registry_version");--> statement-breakpoint
CREATE INDEX "budget_reservation_cost_event_id_idx" ON "budget_reservation" USING btree ("cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_lease_active_lease_key_key" ON "workflow_lease" USING btree ("lease_key") WHERE "workflow_lease"."status" = 'active';