-- 0021: 1 デプロイ = 1 チーム。テナントの列を外す。投影はイベントから作り直せるので空にする（次の読み出しで追いつく）。
-- events は 1 テナント分しか入っていない前提（複数あれば主キーの付け替えで失敗する）
DELETE FROM "projection_meta";--> statement-breakpoint
DELETE FROM "threads";--> statement-breakpoint
DELETE FROM "signals";--> statement-breakpoint
DROP INDEX "events_type_idx";--> statement-breakpoint
DROP INDEX "threads_data_source_idx";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_tenant_id_seq_pk";--> statement-breakpoint
ALTER TABLE "signals" DROP CONSTRAINT "signals_tenant_id_id_pk";--> statement-breakpoint
ALTER TABLE "threads" DROP CONSTRAINT "threads_tenant_id_id_pk";--> statement-breakpoint
ALTER TABLE "projection_meta" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "events" ADD PRIMARY KEY ("seq");--> statement-breakpoint
ALTER TABLE "signals" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "threads" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "projection_meta" ADD COLUMN "id" integer PRIMARY KEY NOT NULL;--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "threads_data_source_idx" ON "threads" USING btree ("data_source_id");--> statement-breakpoint
ALTER TABLE "dummy_queue" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "signals" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN "tenant_id";
