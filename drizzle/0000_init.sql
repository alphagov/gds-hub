CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'publish', 'unpublish');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."engineering_or_business_tool" AS ENUM('engineering', 'business');--> statement-breakpoint
CREATE TYPE "public"."migration_status" AS ENUM('not_started', 'in_progress', 'complete');--> statement-breakpoint
CREATE TYPE "public"."page_type" AS ENUM('policy', 'service_guide', 'guidance', 'general', 'whats_new');--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "capabilities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"group_name" text,
	"comment" text,
	"weight" integer,
	"hide_in_navigation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capabilities_key_unique" UNIQUE("key"),
	CONSTRAINT "capabilities_key_format" CHECK ("capabilities"."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "capability_tools" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "capability_tools_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"capability_id" bigint NOT NULL,
	"tool_id" bigint NOT NULL,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_tools_capability_id_tool_id_unique" UNIQUE("capability_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contracts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tool_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"start_date" date,
	"end_date" date,
	"license_type" text,
	"license_terms" text,
	"procurement_route" text,
	"cost" text,
	"cost_model" text,
	"commercials" text,
	"data_protection_and_security" text,
	"operational_policy" text,
	"total_users" text,
	"renewal_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_id_tool_id_unique" UNIQUE("id","tool_id"),
	CONSTRAINT "contracts_dates_in_order" CHECK ("contracts"."start_date" IS NULL OR "contracts"."end_date" IS NULL OR "contracts"."end_date" >= "contracts"."start_date")
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "instances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tool_id" bigint NOT NULL,
	"contract_id" bigint,
	"url" text,
	"description" text,
	"getting_access" text,
	"management" text,
	"authentication" text,
	"user_provisioning" text,
	"support" text,
	"escalation_contact" text,
	"supported_by_gds_software_service_desk" boolean DEFAULT false NOT NULL,
	"not_in_use" boolean DEFAULT false NOT NULL,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"migration_status" "migration_status" DEFAULT 'not_started' NOT NULL,
	"migration_date" date,
	"ownership_level_id" bigint,
	"target_ownership_level_id" bigint,
	"extra_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_reviewed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instances_key_unique" UNIQUE("key"),
	CONSTRAINT "instances_slug_unique" UNIQUE("slug"),
	CONSTRAINT "instances_key_format" CHECK ("instances"."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "instances_slug_format" CHECK ("instances"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "instances_extra_attributes_format" CHECK (CASE WHEN jsonb_typeof("instances"."extra_attributes") = 'object'
        THEN NOT jsonb_path_exists("instances"."extra_attributes", 'strict $.* ? (@.type() != "string")')
        ELSE false END),
	CONSTRAINT "instances_url_format" CHECK ("instances"."url" IS NULL OR "instances"."url" ~* '^https?://[^[:space:][:cntrl:]]+$')
);
--> statement-breakpoint
CREATE TABLE "ownership_levels" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ownership_levels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"name" text NOT NULL,
	"definition" text,
	"description" text,
	"target_state" text,
	"weight" integer,
	"hide_in_navigation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_levels_key_unique" UNIQUE("key"),
	CONSTRAINT "ownership_levels_key_format" CHECK ("ownership_levels"."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "supplier_tools" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_tools_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier_id" bigint NOT NULL,
	"tool_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_tools_supplier_id_tool_id_unique" UNIQUE("supplier_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "suppliers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"url" text,
	"account_manager_name" text,
	"account_manager_email" text,
	"support_contact" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_name_unique" UNIQUE("name"),
	CONSTRAINT "suppliers_url_format" CHECK ("suppliers"."url" IS NULL OR "suppliers"."url" ~* '^https?://[^[:space:][:cntrl:]]+$')
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tools_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"engineering_or_business_tool" "engineering_or_business_tool",
	"vendor_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_key_unique" UNIQUE("key"),
	CONSTRAINT "tools_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tools_key_format" CHECK ("tools"."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "tools_slug_format" CHECK ("tools"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vendors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"url" text,
	"support_contact" text,
	"data_protection_contact" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_slug_unique" UNIQUE("slug"),
	CONSTRAINT "vendors_name_unique" UNIQUE("name"),
	CONSTRAINT "vendors_slug_format" CHECK ("vendors"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "vendors_url_format" CHECK ("vendors"."url" IS NULL OR "vendors"."url" ~* '^https?://[^[:space:][:cntrl:]]+$')
);
--> statement-breakpoint
CREATE TABLE "business_unit_product_team_services" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_unit_product_team_services_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"business_unit_id" bigint NOT NULL,
	"product_team_service_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bu_pts_business_unit_id_pts_id_unique" UNIQUE("business_unit_id","product_team_service_id")
);
--> statement-breakpoint
CREATE TABLE "business_units" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_units_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"name" text NOT NULL,
	"level" text,
	"description" text,
	"lead" text,
	"url" text,
	"escalation_contact" text,
	"parent_id" bigint,
	"weight" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_units_key_unique" UNIQUE("key"),
	CONSTRAINT "business_units_key_format" CHECK ("business_units"."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "business_units_url_format" CHECK ("business_units"."url" IS NULL OR "business_units"."url" ~* '^https?://[^[:space:][:cntrl:]]+$'),
	CONSTRAINT "business_units_not_own_parent" CHECK ("business_units"."parent_id" IS NULL OR "business_units"."parent_id" <> "business_units"."id")
);
--> statement-breakpoint
CREATE TABLE "instance_capabilities" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "instance_capabilities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"instance_id" bigint NOT NULL,
	"capability_id" bigint NOT NULL,
	"product_team_service_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_capabilities_instance_capability_pts_unique" UNIQUE("instance_id","capability_id","product_team_service_id")
);
--> statement-breakpoint
CREATE TABLE "product_team_service_instances" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_team_service_instances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_team_service_id" bigint NOT NULL,
	"instance_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pts_instances_pts_id_instance_id_unique" UNIQUE("product_team_service_id","instance_id")
);
--> statement-breakpoint
CREATE TABLE "product_team_services" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_team_services_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"url" text,
	"slack_channel" text,
	"slack_channel_name" text,
	"team_email_address" text,
	"gh_orgs" text[] DEFAULT '{}'::text[] NOT NULL,
	"escalation_contact" text,
	"last_reviewed_at" date,
	"weight" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_team_services_key_unique" UNIQUE("key"),
	CONSTRAINT "product_team_services_slug_unique" UNIQUE("slug"),
	CONSTRAINT "product_team_services_key_format" CHECK ("product_team_services"."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "product_team_services_slug_format" CHECK ("product_team_services"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "product_team_services_url_format" CHECK ("product_team_services"."url" IS NULL OR "product_team_services"."url" ~* '^https?://[^[:space:][:cntrl:]]+$'),
	CONSTRAINT "product_team_services_slack_channel_format" CHECK ("product_team_services"."slack_channel" IS NULL OR "product_team_services"."slack_channel" ~* '^https?://[^[:space:][:cntrl:]]+$'),
	CONSTRAINT "product_team_services_gh_orgs_format" CHECK (CASE WHEN "product_team_services"."gh_orgs"::text ~ '^[{]([A-Za-z0-9]+(-[A-Za-z0-9]+)*(,[A-Za-z0-9]+(-[A-Za-z0-9]+)*)*)?[}]$'
        THEN array_position("product_team_services"."gh_orgs", NULL) IS NULL
        ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_type" varchar(64) NOT NULL,
	"entity_id" bigint NOT NULL,
	"action" "audit_action" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_name" varchar(255) NOT NULL,
	"actor_subject" varchar(255) NOT NULL,
	"source_ip" varchar(64),
	"request_id" varchar(128),
	"change_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_present" CHECK (length(trim("audit_log"."actor_name")) > 0 AND length(trim("audit_log"."actor_subject")) > 0),
	CONSTRAINT "audit_log_changed_fields_is_array" CHECK (jsonb_typeof("audit_log"."changed_fields") = 'array'),
	CONSTRAINT "audit_log_values_match_action" CHECK (("audit_log"."action" = 'create' AND "audit_log"."before" IS NULL AND "audit_log"."after" IS NOT NULL)
        OR ("audit_log"."action" = 'delete' AND "audit_log"."before" IS NOT NULL AND "audit_log"."after" IS NULL)
        OR ("audit_log"."action" IN ('update', 'publish', 'unpublish')
            AND "audit_log"."before" IS NOT NULL AND "audit_log"."after" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" varchar(160) NOT NULL,
	"title" varchar(255) NOT NULL,
	"page_type" "page_type" NOT NULL,
	"summary" text,
	"body_markdown" text NOT NULL,
	"owner_name" varchar(255),
	"owner_contact" text,
	"product_team_service_id" bigint,
	"status" "content_status" DEFAULT 'published' NOT NULL,
	"last_reviewed_at" date,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_slug_unique" UNIQUE("slug"),
	CONSTRAINT "pages_slug_format" CHECK ("pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "capability_tools" ADD CONSTRAINT "capability_tools_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_tools" ADD CONSTRAINT "capability_tools_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_ownership_level_id_ownership_levels_id_fk" FOREIGN KEY ("ownership_level_id") REFERENCES "public"."ownership_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_target_ownership_level_id_ownership_levels_id_fk" FOREIGN KEY ("target_ownership_level_id") REFERENCES "public"."ownership_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_contract_tool_fk" FOREIGN KEY ("contract_id","tool_id") REFERENCES "public"."contracts"("id","tool_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_tools" ADD CONSTRAINT "supplier_tools_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_tools" ADD CONSTRAINT "supplier_tools_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_unit_product_team_services" ADD CONSTRAINT "bu_pts_business_unit_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_unit_product_team_services" ADD CONSTRAINT "bu_pts_pts_fk" FOREIGN KEY ("product_team_service_id") REFERENCES "public"."product_team_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_units" ADD CONSTRAINT "business_units_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."business_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_capabilities" ADD CONSTRAINT "instance_capabilities_instance_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_capabilities" ADD CONSTRAINT "instance_capabilities_capability_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_capabilities" ADD CONSTRAINT "instance_capabilities_pts_fk" FOREIGN KEY ("product_team_service_id") REFERENCES "public"."product_team_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_team_service_instances" ADD CONSTRAINT "pts_instances_pts_fk" FOREIGN KEY ("product_team_service_id") REFERENCES "public"."product_team_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_team_service_instances" ADD CONSTRAINT "pts_instances_instance_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_product_team_service_id_product_team_services_id_fk" FOREIGN KEY ("product_team_service_id") REFERENCES "public"."product_team_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capability_tools_tool_id_idx" ON "capability_tools" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "contracts_tool_id_idx" ON "contracts" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "contracts_supplier_id_idx" ON "contracts" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "instances_tool_id_idx" ON "instances" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "instances_contract_id_idx" ON "instances" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "instances_ownership_level_id_idx" ON "instances" USING btree ("ownership_level_id");--> statement-breakpoint
CREATE INDEX "instances_target_ownership_level_id_idx" ON "instances" USING btree ("target_ownership_level_id");--> statement-breakpoint
CREATE INDEX "supplier_tools_tool_id_idx" ON "supplier_tools" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "tools_vendor_id_idx" ON "tools" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "bu_pts_pts_id_idx" ON "business_unit_product_team_services" USING btree ("product_team_service_id");--> statement-breakpoint
CREATE INDEX "business_units_parent_id_idx" ON "business_units" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "instance_capabilities_capability_id_idx" ON "instance_capabilities" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "instance_capabilities_pts_id_idx" ON "instance_capabilities" USING btree ("product_team_service_id");--> statement-breakpoint
CREATE INDEX "pts_instances_instance_id_idx" ON "product_team_service_instances" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "pages_product_team_service_id_idx" ON "pages" USING btree ("product_team_service_id");--> statement-breakpoint
CREATE INDEX "pages_page_type_idx" ON "pages" USING btree ("page_type");