import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { eq, and, desc } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import * as schema from "../database/schema";

@Injectable()
export class ProcessesService {
  constructor(
    @Inject(DATABASE)
    private db: Database,
  ) {}

  // ─── Process CRUD ─────────────────────────────────────────────────

  async create(tenantId: string, userId: string, name: string, description?: string) {
    const [process] = await this.db
      .insert(schema.processes)
      .values({
        tenantId,
        createdBy: userId,
        name,
        description: description || null,
        status: "DRAFT",
        step: "DOCUMENT", // completed details → now on document step
      })
      .returning();
    return process;
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
