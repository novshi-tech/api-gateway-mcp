CREATE TABLE "dummy_queue" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dummy_queue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"message" jsonb NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"thread_id" text,
	"data" jsonb NOT NULL,
	CONSTRAINT "signals_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "threads_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE INDEX "threads_data_source_idx" ON "threads" USING btree ("tenant_id","data_source_id");