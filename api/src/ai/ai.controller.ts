import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { AiService, SCAFFOLD_MODEL } from "./ai.service";
import { ListInteractionsDto } from "./dto/list-interactions.dto";
import { RefineProcessDto } from "./dto/refine-process.dto";
import { ScaffoldProcessDto } from "./dto/scaffold-process.dto";

/** Minimal structural type over the Fastify reply: we only touch `.raw`
 *  (the Node.js http.ServerResponse). Avoids adding `fastify` as an
 *  explicit dep just for one field. */
type StreamingReply = { raw: ServerResponse };

/** Minimum ms between `progress` events we push down the SSE stream.
 *  The underlying Anthropic callback fires on every input-json delta
 *  (dozens per second); clients only need a heartbeat, not a firehose. */
const PROGRESS_THROTTLE_MS = 200;

/** Comment-frame keepalive interval. Proxies (nginx, Cloudflare) close
 *  idle connections around 30–60s; a 15s ping keeps long generations
 *  alive without being noisy. */
const HEARTBEAT_MS = 15_000;

@Controller("ai")
@UseGuards(JwtAuthGuard)
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly ai: AiService) {}

  /** POST /ai/scaffold-process
   *  Turn a plain-language description into a canvas-ready
   *  {nodes, edges} payload. The frontend loads the result via
   *  `loadCanvasData` — user can accept, edit, or regenerate.
   *  Tenant-scoped via the JWT guard; rate-limited per tenant inside
   *  the service. */
  @Post("scaffold-process")
  scaffold(@Req() req: AuthenticatedRequest, @Body() dto: ScaffoldProcessDto) {
    return this.ai.scaffoldProcess({
      description: dto.description,
      businessDocSchema: dto.businessDocSchema,
      tenantId: req.user.tenantId,
      userId: req.user.sub,
    });
  }

  /** GET /ai/interactions?limit=20&before=<ISO>
   *  Tenant-scoped list of past AI interactions, newest first. Keyset
   *  pagination via `before` (the prior page's oldest createdAt).
   *  Excludes `responseJson` so the list view stays small. */
  @Get("interactions")
  listInteractions(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListInteractionsDto,
  ) {
    return this.ai.listInteractions(req.user.tenantId, {
      limit: query.limit,
      before: query.before ? new Date(query.before) : undefined,
    });
  }

  /** GET /ai/interactions/:id
   *  Single interaction including `responseJson` — used by the dialog's
   *  "Re-apply" action to hydrate the canvas from a past scaffold. */
  @Get("interactions/:id")
  getInteraction(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.ai.getInteraction(req.user.tenantId, id);
  }

  /** POST /ai/scaffold-process-stream
   *  Same contract as /scaffold-process, but streams SSE:
   *    event: start   → { model }
   *    event: progress→ { charsOut, elapsedMs }   (throttled)
   *    event: complete→ <ScaffoldResult>          (sent once)
   *    event: error   → { status, message }       (mapped)
   *  The client keeps the HTTP POST (so auth + body work normally) and
   *  reads the response as a ReadableStream. Errors are *always* sent
   *  as SSE `error` events with a 200 status — the stream is already
   *  open by the time we know the outcome.
   *
   *  Note: because this handler uses `@Res()` directly, NestJS's global
   *  exception filter does NOT fire — errors are caught inline and
   *  emitted as SSE frames. Pre-handler layers (JwtAuthGuard,
   *  ValidationPipe) still produce normal JSON responses before any
   *  SSE headers go out, which is what the client expects. */
  @Post("scaffold-process-stream")
  scaffoldStream(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ScaffoldProcessDto,
    @Res() reply: StreamingReply,
  ): Promise<void> {
    return this.runSseStream(reply, (abortSignal, onProgress) =>
      this.ai.scaffoldProcessStream({
        description: dto.description,
        businessDocSchema: dto.businessDocSchema,
        tenantId: req.user.tenantId,
        userId: req.user.sub,
        abortSignal,
        onProgress,
      }),
    );
  }

  /** POST /ai/refine-process-stream
   *  Iterative companion to /scaffold-process-stream: the user provides
   *  a description *plus* the current canvas snapshot, and Claude emits
   *  an ordered list of add/modify/remove ops rather than a wholesale
   *  scaffold. Same SSE framing as the scaffold endpoint. */
  @Post("refine-process-stream")
  refineStream(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RefineProcessDto,
    @Res() reply: StreamingReply,
  ): Promise<void> {
    return this.runSseStream(reply, (abortSignal, onProgress) =>
      this.ai.refineProcessStream({
        description: dto.description,
        currentCanvas: dto.currentCanvas,
        businessDocSchema: dto.businessDocSchema,
        tenantId: req.user.tenantId,
        userId: req.user.sub,
        abortSignal,
        onProgress,
      }),
    );
  }

  /** Shared SSE driver for both streaming AI endpoints.
   *
   *  Handles: headers + flush, destroyed-socket guard, client-disconnect
   *  detection (gated on writableEnded so normal completion doesn't fire
   *  a spurious abort), 15s heartbeat, 200ms progress throttle, and
   *  inline error mapping to SSE frames (pre-handler layers like
   *  JwtAuthGuard + ValidationPipe still produce normal JSON error
   *  responses before any SSE header goes out). */
  private async runSseStream<T>(
    reply: StreamingReply,
    run: (
      abortSignal: AbortSignal,
      onProgress: (p: { charsOut: number; elapsedMs: number }) => void,
    ) => Promise<T>,
  ): Promise<void> {
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();

    reply.raw.on("error", (err) => {
      this.logger.debug?.(`stream socket error: ${(err as Error).message}`);
    });

    const writeRaw = (chunk: string): void => {
      if (reply.raw.writableEnded || reply.raw.destroyed) return;
      try {
        reply.raw.write(chunk);
      } catch (err) {
        this.logger.debug?.(`stream write skipped: ${(err as Error).message}`);
      }
    };

    const write = (event: string, data: unknown): void => {
      writeRaw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let clientDisconnected = false;
    const abortController = new AbortController();
    const onClientClose = () => {
      if (reply.raw.writableEnded) return;
      clientDisconnected = true;
      abortController.abort();
    };
    reply.raw.on("close", onClientClose);

    const heartbeat = setInterval(() => writeRaw(`: ping\n\n`), HEARTBEAT_MS);

    write("start", { model: SCAFFOLD_MODEL });

    let lastProgressAt = 0;
    const throttledProgress = (p: { charsOut: number; elapsedMs: number }) => {
      const now = Date.now();
      if (now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
      lastProgressAt = now;
      write("progress", p);
    };

    try {
      const result = await run(abortController.signal, throttledProgress);
      write("complete", result);
    } catch (err) {
      if (clientDisconnected) {
        // Socket is gone; the service already skipped persistence.
      } else if (err instanceof HttpException) {
        write("error", { status: err.getStatus(), message: err.message });
      } else {
        this.logger.error("Unexpected error in SSE stream", (err as Error)?.stack);
        write("error", { status: 500, message: "Unexpected error." });
      }
    } finally {
      clearInterval(heartbeat);
      reply.raw.off("close", onClientClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  }
}
