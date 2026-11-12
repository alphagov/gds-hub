CREATE TABLE "redirects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "redirects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"old_path" text NOT NULL,
	"new_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirects_old_path_unique" UNIQUE("old_path"),
	CONSTRAINT "redirects_old_path_format" CHECK ("redirects"."old_path" ~ '^/([^/[:space:][:cntrl:]][^[:space:][:cntrl:]]*)?$'
      AND strpos("redirects"."old_path", chr(92)) = 0
      AND length("redirects"."old_path") <= 2048),
	CONSTRAINT "redirects_new_path_format" CHECK ("redirects"."new_path" ~ '^/([^/[:space:][:cntrl:]][^[:space:][:cntrl:]]*)?$'
      AND strpos("redirects"."new_path", chr(92)) = 0
      AND length("redirects"."new_path") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "contracts" ALTER COLUMN "supplier_id" DROP NOT NULL;