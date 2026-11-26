// A fake edit service for the route tests. Every name and value is invented.

import { RepositoryError } from "../../../src/repositories/errors.js";
import type { Actor } from "../../../src/services/audit/actor.js";
import type {
  ChoiceOption,
  EditRecord,
  EditRecordDetail,
  EditService,
  EditValues,
} from "../../../src/services/editing/edit-service.js";
import type { EditEntityKey } from "../../../src/editing/entities.js";

export const CHANGED_AT = new Date("2026-10-01T09:00:00.000Z");

export interface RecordedWrite {
  readonly operation: "create" | "update" | "remove";
  readonly entity: EditEntityKey;
  readonly id?: number;
  readonly values?: EditValues;
  readonly actor: Actor;
  readonly expectedUpdatedAt?: Date;
}

export interface FakeEditService extends EditService {
  readonly writes: RecordedWrite[];
}

export function vendorDetail(overrides: Partial<EditRecordDetail> = {}): EditRecordDetail {
  return {
    id: 3,
    title: "Compass Co",
    updatedAt: CHANGED_AT,
    values: {
      slug: "compass-co",
      name: "Compass Co",
      description: "Makes compasses.",
      url: "https://compass.example.com",
      supportContact: null,
      dataProtectionContact: null,
    },
    ...overrides,
  };
}

export function pageDetail(overrides: Partial<EditRecordDetail> = {}): EditRecordDetail {
  return {
    id: 5,
    title: "Device rules",
    updatedAt: CHANGED_AT,
    values: {
      slug: "device-rules",
      title: "Device rules",
      pageType: "policy",
      summary: "What you can connect.",
      bodyMarkdown: "## Scope\n\nLaptops only.",
      ownerName: "Information Security",
      ownerContact: "infosec@example.com",
      productTeamServiceId: null,
      status: "published",
      lastReviewedAt: "2026-07-15",
    },
    ...overrides,
  };
}

/**
 * An edit service with one vendor (id 3) and one page (id 5). Pass overrides
 * to make a method fail or return something else.
 */
export function fakeEditService(overrides: Partial<EditService> = {}): FakeEditService {
  const writes: RecordedWrite[] = [];
  const summary = (detail: EditRecordDetail): EditRecord => ({
    id: detail.id,
    title: detail.title,
    updatedAt: detail.updatedAt,
  });
  const service: EditService = {
    list: (entity) =>
      Promise.resolve(
        entity === "vendors"
          ? [summary(vendorDetail())]
          : entity === "pages"
            ? [summary(pageDetail())]
            : [],
      ),
    find: (entity, id) => {
      if (entity === "vendors" && id === 3) return Promise.resolve(vendorDetail());
      if (entity === "pages" && id === 5) return Promise.resolve(pageDetail());
      return Promise.resolve(undefined);
    },
    choices: (): Promise<Readonly<Record<string, ChoiceOption[]>>> =>
      Promise.resolve({
        productTeamServiceId: [{ value: "1", text: "Mapping Team" }],
        vendorId: [{ value: "3", text: "Compass Co" }],
        toolId: [{ value: "2", text: "Atlas Maker" }],
      }),
    create: (entity, values, actor) => {
      writes.push({ operation: "create", entity, values, actor });
      return Promise.resolve({ id: 9, title: "New record", updatedAt: CHANGED_AT });
    },
    update: (entity, id, values, actor, expectedUpdatedAt) => {
      writes.push({ operation: "update", entity, id, values, actor, expectedUpdatedAt });
      return Promise.resolve({ id, title: "Updated record", updatedAt: CHANGED_AT });
    },
    remove: (entity, id, actor, expectedUpdatedAt) => {
      writes.push({ operation: "remove", entity, id, actor, expectedUpdatedAt });
      return Promise.resolve({ id, title: "Removed record", updatedAt: CHANGED_AT });
    },
    ...overrides,
  };
  return Object.assign(service, { writes });
}

export function repositoryError(kind: RepositoryError["kind"]): RepositoryError {
  return new RepositoryError(kind, "vendor", { operation: "update" });
}
