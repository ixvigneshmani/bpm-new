/* Unit tests for the ProcessPermissionsService resolver. Drive the
 * service against a hand-rolled in-memory fake DB that mimics the
 * subset of drizzle's select/where/insert chain the service uses. */

import { beforeEach, describe, expect, it } from "vitest";
import {
  ProcessPermissionsService,
  type ProcessPermission,
} from "../process-permissions.service";
import * as schema from "../../database/schema";

const TENANT = "00000000-0000-4000-8000-000000000001";
const PROCESS_A = "00000000-0000-4000-8000-0000000000a1";
const PROCESS_B = "00000000-0000-4000-8000-0000000000a2";
const ALICE = "00000000-0000-4000-8000-00000000aaaa";
const BOB = "00000000-0000-4000-8000-00000000bbbb";

interface Grant {
  id: string;
  tenantId: string;
  processId: string;
  granteeType: "user" | "role";
  granteeId: string;
  permission: ProcessPermission;
}

function makeFakeDb(grants: Grant[]) {
  const store = [...grants];
  // Minimal chainable: select().from(table).where(predicateFn).
  // The service only uses select with where on tenant + processId
  // (and an inArray variant for filterVisible). We intercept the
  // drizzle predicate by snooping the columns referenced.
  // Easier: have the chain accept any predicate and apply a filter
  // we synthesize from the test's perspective.
  return {
    select() {
      return {
        from(_table: unknown) {
          return {
            where(_cond: unknown) {
              // The condition's exact shape isn't introspected — tests
              // build the fake DB with only the rows for the (tenant,
              // process) under test, so this returns all rows. For
              // filterVisible across multiple processes, callers pass
              // all rows and let the service partition.
              return Promise.resolve(
                store.map((g) => ({
                  id: g.id,
                  permission: g.permission,
                  granteeType: g.granteeType,
                  granteeId: g.granteeId,
                  processId: g.processId,
                })),
              );
            },
          };
        },
      };
    },
    insert() {
      return {
        values(_v: unknown) {
          return { returning: () => Promise.resolve([]) };
        },
      };
    },
    delete() {
      return {
        where(_c: unknown) {
          return { returning: () => Promise.resolve([]) };
        },
      };
    },
  } as unknown as ConstructorParameters<typeof ProcessPermissionsService>[0];
}

function caller(opts: {
  systemRole?: "owner" | "admin" | "member" | "viewer";
  roles?: string[];
  userId?: string;
}) {
  return {
    userId: opts.userId ?? ALICE,
    tenantId: TENANT,
    systemRole: opts.systemRole ?? "member",
    roles: opts.roles ?? [],
  };
}

describe("ProcessPermissionsService.can", () => {
  it("owner always passes regardless of permission or grants", async () => {
    const svc = new ProcessPermissionsService(makeFakeDb([]));
    for (const p of ["view", "start", "edit", "publish", "admin"] as const) {
      expect(
        await svc.can(caller({ systemRole: "owner" }), PROCESS_A, p),
      ).toBe(true);
    }
  });

  it("admin always passes regardless of permission or grants", async () => {
    const svc = new ProcessPermissionsService(makeFakeDb([]));
    for (const p of ["view", "start", "edit", "publish", "admin"] as const) {
      expect(
        await svc.can(caller({ systemRole: "admin" }), PROCESS_A, p),
      ).toBe(true);
    }
  });

  it("member without grants: view + start open, edit/publish/admin denied", async () => {
    const svc = new ProcessPermissionsService(makeFakeDb([]));
    expect(await svc.can(caller({}), PROCESS_A, "view")).toBe(true);
    expect(await svc.can(caller({}), PROCESS_A, "start")).toBe(true);
    expect(await svc.can(caller({}), PROCESS_A, "edit")).toBe(false);
    expect(await svc.can(caller({}), PROCESS_A, "publish")).toBe(false);
    expect(await svc.can(caller({}), PROCESS_A, "admin")).toBe(false);
  });

  it("member with explicit user `edit` grant: view + edit pass; publish denied", async () => {
    const svc = new ProcessPermissionsService(
      makeFakeDb([
        {
          id: "g1",
          tenantId: TENANT,
          processId: PROCESS_A,
          granteeType: "user",
          granteeId: ALICE,
          permission: "edit",
        },
      ]),
    );
    expect(await svc.can(caller({}), PROCESS_A, "view")).toBe(true);
    expect(await svc.can(caller({}), PROCESS_A, "edit")).toBe(true);
    expect(await svc.can(caller({}), PROCESS_A, "publish")).toBe(false);
  });

  it("once a process is restricted (has any grant), unrelated members lose default view", async () => {
    const svc = new ProcessPermissionsService(
      makeFakeDb([
        {
          id: "g1",
          tenantId: TENANT,
          processId: PROCESS_A,
          granteeType: "user",
          granteeId: BOB,
          permission: "edit",
        },
      ]),
    );
    expect(
      await svc.can(caller({ userId: ALICE }), PROCESS_A, "view"),
    ).toBe(false);
    expect(
      await svc.can(caller({ userId: ALICE }), PROCESS_A, "start"),
    ).toBe(false);
    expect(await svc.can(caller({ userId: BOB }), PROCESS_A, "view")).toBe(
      true,
    );
    expect(await svc.can(caller({ userId: BOB }), PROCESS_A, "edit")).toBe(
      true,
    );
  });

  it("role grant: any user holding that role gets the permission", async () => {
    const svc = new ProcessPermissionsService(
      makeFakeDb([
        {
          id: "g1",
          tenantId: TENANT,
          processId: PROCESS_A,
          granteeType: "role",
          granteeId: "manager",
          permission: "publish",
        },
      ]),
    );
    expect(
      await svc.can(caller({ roles: ["manager"] }), PROCESS_A, "publish"),
    ).toBe(true);
    // publish ⊃ edit ⊃ view
    expect(
      await svc.can(caller({ roles: ["manager"] }), PROCESS_A, "edit"),
    ).toBe(true);
    expect(
      await svc.can(caller({ roles: ["manager"] }), PROCESS_A, "view"),
    ).toBe(true);
    // admin not implied by publish
    expect(
      await svc.can(caller({ roles: ["manager"] }), PROCESS_A, "admin"),
    ).toBe(false);
    // someone without the role gets no inherited rights
    expect(
      await svc.can(caller({ roles: ["employee"] }), PROCESS_A, "publish"),
    ).toBe(false);
  });

  it("start permission is orthogonal: edit grant doesn't imply start", async () => {
    const svc = new ProcessPermissionsService(
      makeFakeDb([
        {
          id: "g1",
          tenantId: TENANT,
          processId: PROCESS_A,
          granteeType: "user",
          granteeId: ALICE,
          permission: "edit",
        },
      ]),
    );
    // edit implies view but NOT start
    expect(await svc.can(caller({}), PROCESS_A, "start")).toBe(false);
  });

  it("admin permission implies everything including start", async () => {
    const svc = new ProcessPermissionsService(
      makeFakeDb([
        {
          id: "g1",
          tenantId: TENANT,
          processId: PROCESS_A,
          granteeType: "user",
          granteeId: ALICE,
          permission: "admin",
        },
      ]),
    );
    expect(await svc.can(caller({}), PROCESS_A, "view")).toBe(true);
    expect(await svc.can(caller({}), PROCESS_A, "start")).toBe(true);
    expect(await svc.can(caller({}), PROCESS_A, "edit")).toBe(true);
    expect(await svc.can(caller({}), PROCESS_A, "publish")).toBe(true);
    expect(await svc.can(caller({}), PROCESS_A, "admin")).toBe(true);
  });
});

describe("ProcessPermissionsService.assert", () => {
  it("returns void when allowed", async () => {
    const svc = new ProcessPermissionsService(makeFakeDb([]));
    await expect(
      svc.assert(caller({ systemRole: "owner" }), PROCESS_A, "admin"),
    ).resolves.toBeUndefined();
  });

  it("throws ForbiddenException when denied", async () => {
    const svc = new ProcessPermissionsService(makeFakeDb([]));
    await expect(
      svc.assert(caller({}), PROCESS_A, "publish"),
    ).rejects.toThrow(/'publish' permission/);
  });
});
