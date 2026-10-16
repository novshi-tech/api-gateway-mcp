CREATE TABLE "derivations" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "derivations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "dummy_queue" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dummy_queue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" text NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"message" jsonb NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"tenant_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "events_tenant_id_seq_pk" PRIMARY KEY("tenant_id","seq")
);
--> statement-breakpoint
CREATE TABLE "ignore_log" (
	"tenant_id" text NOT NULL,
	"ord" integer NOT NULL,
	"signal_id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "ignore_log_tenant_id_ord_pk" PRIMARY KEY("tenant_id","ord")
);
--> statement-breakpoint
CREATE TABLE "master" (
	"kind" text NOT NULL,
	"ord" integer NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "master_kind_ord_pk" PRIMARY KEY("kind","ord")
);
--> statement-breakpoint
CREATE TABLE "projection_meta" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"last_seq" integer NOT NULL,
	"idx" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"task_id" text,
	"data" jsonb NOT NULL,
	CONSTRAINT "signals_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "task_links" (
	"tenant_id" text NOT NULL,
	"derivation_id" text NOT NULL,
	"source_task_id" text NOT NULL,
	"target_task_id" text NOT NULL,
	CONSTRAINT "task_links_tenant_id_derivation_id_pk" PRIMARY KEY("tenant_id","derivation_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"list_id" text NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "tasks_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "timeline" (
	"tenant_id" text NOT NULL,
	"ord" integer NOT NULL,
	"task_id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "timeline_tenant_id_ord_pk" PRIMARY KEY("tenant_id","ord")
);
--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "tasks_list_idx" ON "tasks" USING btree ("tenant_id","list_id");--> statement-breakpoint
CREATE INDEX "timeline_task_idx" ON "timeline" USING btree ("tenant_id","task_id");