import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { eq, and, desc } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import * as schema from "../database/schema";
import { slugify, appendSlugSuffix } from "./slugify";

@Injectable()
export class ProcessesService {
  constructor(
    @Inject(DATABASE)
    private db: Database,
  ) {}

  // ─── Process CRUD ─────────────────────────────────────────────────

  async create(tenantId: string, userId: string, name: string, description?: string) {
    const slug = await this.allocateSlug(tenantId, slugify(name));
    const [process] = await this.db
      .insert(schema.processes)
      .values({
        tenantId,
        createdBy: userId,
        name,
        description: description || null,
        status: "DRAFT",
        step: "DOCUMENT", // completed details → now on document step
        slug,
      })
      .returning();
    return process;
  }

  /** Find the first slug variant that doesn't collide within the
   *  tenant. Tries the base slug first, then base-2, base-3, … up
   *  to 999. The (TENANT_ID, SLUG) unique index would also catch a
   *  race at insert time; this loop just gets a clean slug ahead of
   *  the insert so the operator sees a sensible value. */
  private async allocateSlug(tenantId: string, base: string): Promise<string> {
    const existing = await this.db
      .select({ slug: schema.processes.slug })
      .from(schema.processes)
      .where(eq(schema.processes.tenantId, tenantId));
    const taken = new Set(existing.map((r) => r.slug).filter(Boolean));
    if (!taken.has(base)) return base;
    for (let n = 2; n < 1000; n++) {
      const candidate = appendSlugSuffix(base, n);
      if (!taken.has(candidate)) return candidate;
    }
    // Pathological — 1000 collisions in one tenant. Append a random
    // suffix as a last resort rather than throwing.
    return appendSlugSuffix(base, Math.floor(Math.random() * 1_000_000));
  }

  async findAll(tenantId: string) {
    return this.db
      .select()
      .from(schema.processes)
      .where(eq(schema.processes.tenantId, tenantId))
      .orderBy(desc(schema.processes.createdAt));
  }

  async findOne(id: string, tenantId: string) {
    const [process] = await this.db
      .select()
      .from(schema.processes)
      .where(
        and(eq(schema.processes.id, id), eq(schema.processes.tenantId, tenantId)),
      );
    if (!process) throw new NotFoundException("Process not found");
    return process;
  }

  async findOneWithDocument(id: string, tenantId: string) {
    const process = await this.findOne(id, tenantId);
    const [doc] = await this.db
      .select()
      .from(schema.processDocuments)
      .where(eq(schema.processDocuments.processId, id));
    const [creator] = await this.db
      .select({ displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, process.createdBy));
    return { ...process, document: doc || null, creatorName: creator?.displayName || null };
  }

  async update(id: string, tenantId: string, data: { name?: string; description?: string }) {
    const [updated] = await this.db
      .update(schema.processes)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(eq(schema.processes.id, id), eq(schema.processes.tenantId, tenantId)),
      )
      .returning();
    if (!updated) throw new NotFoundException("Process not found");
    return updated;
  }

  async saveCanvas(id: string, tenantId: string, canvasData: Record<string, unknown>) {
    await this.findOne(id, tenantId);
    const [updated] = await this.db
      .update(schema.processes)
      .set({ canvasData, updatedAt: new Date() })
      .where(
        and(eq(schema.processes.id, id), eq(schema.processes.tenantId, tenantId)),
      )
      .returning();
    if (!updated) throw new NotFoundException("Process not found");
    return { saved: true };
  }

  async remove(id: string, tenantId: string) {
    const [deleted] = await this.db
      .delete(schema.processes)
      .where(
        and(eq(schema.processes.id, id), eq(schema.processes.tenantId, tenantId)),
      )
      .returning();
    if (!deleted) throw new NotFoundException("Process not found");
    return { deleted: true };
  }

  // ─── Business Document for Process ────────────────────────────────

  async saveDocument(
    processId: string,
    tenantId: string,
    schemaData: Record<string, unknown>,
    source: "TEMPLATE" | "PASTE" | "EMPTY",
    templateId?: string,
  ) {
    // Ensure process exists and belongs to tenant
    await this.findOne(processId, tenantId);

    // Upsert — check if document already exists for this process
    const [existing] = await this.db
      .select()
      .from(schema.processDocuments)
      .where(eq(schema.processDocuments.processId, processId));

    let doc;
    if (existing) {
      [doc] = await this.db
        .update(schema.processDocuments)
        .set({
          schemaOverride: schemaData,
          source,
          documentId: templateId || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.processDocuments.id, existing.id))
        .returning();
    } else {
      [doc] = await this.db
        .insert(schema.processDocuments)
        .values({
          processId,
          documentId: templateId || null,
          schemaOverride: schemaData,
          source,
        })
        .returning();
    }

    // Update process step to CANVAS
    await this.db
      .update(schema.processes)
      .set({ step: "CANVAS", updatedAt: new Date() })
      .where(eq(schema.processes.id, processId));

    return doc;
  }

  async getDocument(processId: string, tenantId: string) {
    await this.findOne(processId, tenantId);
    const [doc] = await this.db
      .select()
      .from(schema.processDocuments)
      .where(eq(schema.processDocuments.processId, processId));
    return doc || null;
  }

  // ─── Business Document Templates ──────────────────────────────────

  async listTemplates(tenantId: string) {
    return this.db
      .select()
      .from(schema.businessDocuments)
      .where(eq(schema.businessDocuments.tenantId, tenantId))
      .orderBy(desc(schema.businessDocuments.createdAt));
  }
}
