-- Full-text search: generated tsvector columns, GIN indexes and the
-- search_index view. Hand-written (drizzle-kit can't express this cleanly), so
-- the search_vector columns are not in the Drizzle table definitions. The view
-- is declared in src/db/schema/search.ts with .existing().
--
-- Weights: A = title or name, B = summary or description, C = body.
-- Uses the 'english' configuration: to_tsvector(regconfig, text) is immutable,
-- which generated columns require.
--
-- If a later migration changes a column used here, drop and recreate the
-- view and the affected search_vector column in the same migration.

ALTER TABLE "vendors" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("name", '')), 'A')
  || setweight(to_tsvector('english', coalesce("description", '')), 'B')
) STORED;
--> statement-breakpoint
CREATE INDEX "vendors_search_vector_idx" ON "vendors" USING gin ("search_vector");
--> statement-breakpoint

ALTER TABLE "tools" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("name", '')), 'A')
  || setweight(to_tsvector('english', coalesce("description", '')), 'B')
) STORED;
--> statement-breakpoint
CREATE INDEX "tools_search_vector_idx" ON "tools" USING gin ("search_vector");
--> statement-breakpoint

ALTER TABLE "instances" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("name", '')), 'A')
  || setweight(to_tsvector('english', coalesce("description", '')), 'B')
  || setweight(to_tsvector('english',
       coalesce("getting_access", '') || ' ' || coalesce("management", '') || ' ' || coalesce("support", '')
     ), 'C')
) STORED;
--> statement-breakpoint
CREATE INDEX "instances_search_vector_idx" ON "instances" USING gin ("search_vector");
--> statement-breakpoint

ALTER TABLE "capabilities" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("name", '')), 'A')
  || setweight(to_tsvector('english', coalesce("description", '')), 'B')
  || setweight(to_tsvector('english', coalesce("comment", '')), 'C')
) STORED;
--> statement-breakpoint
CREATE INDEX "capabilities_search_vector_idx" ON "capabilities" USING gin ("search_vector");
--> statement-breakpoint

ALTER TABLE "product_team_services" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("name", '')), 'A')
  || setweight(to_tsvector('english', coalesce("purpose", '')), 'B')
) STORED;
--> statement-breakpoint
CREATE INDEX "product_team_services_search_vector_idx" ON "product_team_services" USING gin ("search_vector");
--> statement-breakpoint

ALTER TABLE "business_units" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("name", '')), 'A')
  || setweight(to_tsvector('english', coalesce("description", '')), 'B')
) STORED;
--> statement-breakpoint
CREATE INDEX "business_units_search_vector_idx" ON "business_units" USING gin ("search_vector");
--> statement-breakpoint

ALTER TABLE "ownership_levels" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("name", '')), 'A')
  || setweight(to_tsvector('english', coalesce("definition", '')), 'B')
  || setweight(to_tsvector('english',
       coalesce("description", '') || ' ' || coalesce("target_state", '')
     ), 'C')
) STORED;
--> statement-breakpoint
CREATE INDEX "ownership_levels_search_vector_idx" ON "ownership_levels" USING gin ("search_vector");
--> statement-breakpoint

ALTER TABLE "pages" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("title", '')), 'A')
  || setweight(to_tsvector('english', coalesce("summary", '')), 'B')
  || setweight(to_tsvector('english', coalesce("body_markdown", '')), 'C')
) STORED;
--> statement-breakpoint
CREATE INDEX "pages_search_vector_idx" ON "pages" USING gin ("search_vector");
--> statement-breakpoint

-- One row per searchable record, for ranking across types. "slug" is the
-- record's URL identifier (key where the table has no slug). "snippet_source"
-- is the B and C text, for ts_headline. Contracts and suppliers are left out
-- because they hold commercial information. Only published pages appear.
CREATE VIEW "search_index" AS
  SELECT 'vendor'::text AS "entity_type", "id" AS "entity_id", "slug", "name" AS "title",
         "description" AS "summary", coalesce("description", '') AS "snippet_source",
         "search_vector", "updated_at"
    FROM "vendors"
  UNION ALL
  SELECT 'tool'::text, "id", "slug", "name", "description", coalesce("description", ''),
         "search_vector", "updated_at"
    FROM "tools"
  UNION ALL
  SELECT 'instance'::text, "id", "slug", "name", "description",
         concat_ws(' ', "description", "getting_access", "management", "support"),
         "search_vector", "updated_at"
    FROM "instances"
  UNION ALL
  SELECT 'capability'::text, "id", "key", "name", "description",
         concat_ws(' ', "description", "comment"),
         "search_vector", "updated_at"
    FROM "capabilities"
  UNION ALL
  SELECT 'product_team_service'::text, "id", "slug", "name", "purpose", coalesce("purpose", ''),
         "search_vector", "updated_at"
    FROM "product_team_services"
  UNION ALL
  SELECT 'business_unit'::text, "id", "key", "name", "description", coalesce("description", ''),
         "search_vector", "updated_at"
    FROM "business_units"
  UNION ALL
  SELECT 'ownership_level'::text, "id", "key", "name", "definition",
         concat_ws(' ', "definition", "description", "target_state"),
         "search_vector", "updated_at"
    FROM "ownership_levels"
  UNION ALL
  SELECT 'page'::text, "id", "slug"::text, "title"::text, "summary",
         concat_ws(' ', "summary", "body_markdown"),
         "search_vector", "updated_at"
    FROM "pages"
    WHERE "status" = 'published';
