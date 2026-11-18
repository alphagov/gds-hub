import type { PgTable } from "drizzle-orm/pg-core";
import type { Database, Transaction } from "../client.js";
import { entityTypeOf } from "../entity-types.js";
import { firstNonEmptyTable } from "../tables.js";
import {
  auditLog,
  businessUnitProductTeamServices,
  businessUnits,
  capabilities,
  capabilityTools,
  contracts,
  instanceCapabilities,
  instances,
  ownershipLevels,
  pages,
  productTeamServiceInstances,
  productTeamServices,
  redirects,
  supplierTools,
  suppliers,
  tools,
  vendors,
} from "../schema/index.js";
import {
  SEED_ACTOR,
  seedBusinessUnits,
  seedCapabilities,
  seedContracts,
  seedInstanceCapabilities,
  seedInstances,
  seedOwnershipLevels,
  seedPages,
  seedProductTeamServices,
  seedRedirects,
  seedSuppliers,
  seedTools,
  seedVendors,
} from "./seed-data.js";

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedError";
  }
}

/** Looks up the database ID for a seed reference, failing loudly on typos. */
function lookup(ids: ReadonlyMap<string, number>, ref: string, kind: string): number {
  const found = ids.get(ref);
  if (found === undefined) {
    throw new SeedError(`seed data refers to an unknown ${kind}: "${ref}"`);
  }
  return found;
}

function optionalLookup(
  ids: ReadonlyMap<string, number>,
  ref: string | undefined,
  kind: string,
): number | null {
  return ref === undefined ? null : lookup(ids, ref, kind);
}

/** Records a "create" audit entry for each inserted row. */
async function audit(
  tx: Transaction,
  table: PgTable,
  rows: readonly { id: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(auditLog).values(
    rows.map((row) => ({
      entityType: entityTypeOf(table),
      entityId: row.id,
      action: "create" as const,
      after: { ...row },
      changedFields: Object.keys(row),
      actorName: SEED_ACTOR.name,
      actorSubject: SEED_ACTOR.subject,
      changeSummary: "Created by the synthetic seed",
    })),
  );
}

/**
 * Fills an empty, migrated database with synthetic data. Everything is written
 * in one transaction, with an audit_log entry for each row. Refuses to run if
 * any table already has rows: use `npm run db:reset` to start again.
 */
export async function seedDatabase(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    const nonEmpty = await firstNonEmptyTable(tx);
    if (nonEmpty !== undefined) {
      throw new SeedError(
        `the database already has data (in ${nonEmpty}); run db:reset to start again`,
      );
    }

    const levelRows = await tx.insert(ownershipLevels).values(seedOwnershipLevels).returning();
    await audit(tx, ownershipLevels, levelRows);
    const levelIds = new Map(levelRows.map((row) => [row.key, row.id]));

    const vendorRows = await tx.insert(vendors).values(seedVendors).returning();
    await audit(tx, vendors, vendorRows);
    const vendorIds = new Map(vendorRows.map((row) => [row.name, row.id]));

    const supplierRows = await tx.insert(suppliers).values(seedSuppliers).returning();
    await audit(tx, suppliers, supplierRows);
    const supplierIds = new Map(supplierRows.map((row) => [row.name, row.id]));

    const toolRows = await tx
      .insert(tools)
      .values(
        seedTools.map(({ vendor, suppliers: _suppliers, ...tool }) => ({
          ...tool,
          slug: tool.key,
          vendorId: optionalLookup(vendorIds, vendor, "vendor"),
        })),
      )
      .returning();
    await audit(tx, tools, toolRows);
    const toolIds = new Map(toolRows.map((row) => [row.key, row.id]));

    const supplierToolRows = await tx
      .insert(supplierTools)
      .values(
        seedTools.flatMap((tool) =>
          (tool.suppliers ?? []).map((supplier) => ({
            supplierId: lookup(supplierIds, supplier, "supplier"),
            toolId: lookup(toolIds, tool.key, "tool"),
          })),
        ),
      )
      .returning();
    await audit(tx, supplierTools, supplierToolRows);

    // Contracts have no natural key, so insert them one at a time to map each
    // seed reference to its ID.
    const contractIds = new Map<string, number>();
    for (const { ref, tool, supplier, ...contract } of seedContracts) {
      const [row] = await tx
        .insert(contracts)
        .values({
          ...contract,
          toolId: lookup(toolIds, tool, "tool"),
          supplierId: lookup(supplierIds, supplier, "supplier"),
        })
        .returning();
      if (!row) throw new SeedError(`contract "${ref}" was not inserted`);
      await audit(tx, contracts, [row]);
      contractIds.set(ref, row.id);
    }

    const instanceRows = await tx
      .insert(instances)
      .values(
        seedInstances.map(
          ({ tool, contract, ownershipLevel, targetOwnershipLevel, ...instance }) => ({
            ...instance,
            slug: instance.key,
            toolId: lookup(toolIds, tool, "tool"),
            contractId: optionalLookup(contractIds, contract, "contract"),
            ownershipLevelId: optionalLookup(levelIds, ownershipLevel, "ownership level"),
            targetOwnershipLevelId: optionalLookup(
              levelIds,
              targetOwnershipLevel,
              "ownership level",
            ),
          }),
        ),
      )
      .returning();
    await audit(tx, instances, instanceRows);
    const instanceIds = new Map(instanceRows.map((row) => [row.key, row.id]));

    const capabilityRows = await tx
      .insert(capabilities)
      .values(seedCapabilities.map(({ tools: _tools, ...capability }) => capability))
      .returning();
    await audit(tx, capabilities, capabilityRows);
    const capabilityIds = new Map(capabilityRows.map((row) => [row.key, row.id]));

    const capabilityToolRows = await tx
      .insert(capabilityTools)
      .values(
        seedCapabilities.flatMap((capability) =>
          capability.tools.map((tool, position) => ({
            capabilityId: lookup(capabilityIds, capability.key, "capability"),
            toolId: lookup(toolIds, tool, "tool"),
            position,
          })),
        ),
      )
      .returning();
    await audit(tx, capabilityTools, capabilityToolRows);

    const ptsRows = await tx
      .insert(productTeamServices)
      .values(seedProductTeamServices.map(({ uses: _uses, ...pts }) => ({ ...pts, slug: pts.key })))
      .returning();
    await audit(tx, productTeamServices, ptsRows);
    const ptsIds = new Map(ptsRows.map((row) => [row.key, row.id]));

    const ptsInstanceValues = seedProductTeamServices.flatMap((pts) =>
      pts.uses.map((instance) => ({
        productTeamServiceId: lookup(ptsIds, pts.key, "product, team or service"),
        instanceId: lookup(instanceIds, instance, "instance"),
      })),
    );
    const ptsInstanceRows = await tx
      .insert(productTeamServiceInstances)
      .values(ptsInstanceValues)
      .returning();
    await audit(tx, productTeamServiceInstances, ptsInstanceRows);

    const instanceCapabilityRows = await tx
      .insert(instanceCapabilities)
      .values(
        seedInstanceCapabilities.map((link) => ({
          instanceId: lookup(instanceIds, link.instance, "instance"),
          capabilityId: lookup(capabilityIds, link.capability, "capability"),
          productTeamServiceId: lookup(ptsIds, link.productTeamService, "product, team or service"),
        })),
      )
      .returning();
    await audit(tx, instanceCapabilities, instanceCapabilityRows);

    // One at a time, so each parent exists before its children.
    const unitIds = new Map<string, number>();
    for (const { parent, operates, ...unit } of seedBusinessUnits) {
      const [row] = await tx
        .insert(businessUnits)
        .values({ ...unit, parentId: optionalLookup(unitIds, parent, "business unit") })
        .returning();
      if (!row) throw new SeedError(`business unit "${unit.key}" was not inserted`);
      await audit(tx, businessUnits, [row]);
      unitIds.set(row.key, row.id);

      if (operates.length > 0) {
        const linkRows = await tx
          .insert(businessUnitProductTeamServices)
          .values(
            operates.map((pts) => ({
              businessUnitId: row.id,
              productTeamServiceId: lookup(ptsIds, pts, "product, team or service"),
            })),
          )
          .returning();
        await audit(tx, businessUnitProductTeamServices, linkRows);
      }
    }

    const pageRows = await tx
      .insert(pages)
      .values(
        seedPages.map(({ productTeamService, ...page }) => ({
          ...page,
          productTeamServiceId: optionalLookup(
            ptsIds,
            productTeamService,
            "product, team or service",
          ),
        })),
      )
      .returning();
    await audit(tx, pages, pageRows);

    const redirectRows = await tx.insert(redirects).values(seedRedirects).returning();
    await audit(tx, redirects, redirectRows);
  });
}
