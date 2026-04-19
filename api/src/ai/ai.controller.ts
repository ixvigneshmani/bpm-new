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
  async scaffoldStream(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ScaffoldProcessDto,
    @Res() reply: StreamingReply,
  ): Promise<void> {
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    // Disable proxy buffering (nginx, Cloudflare) so events flush immediately.
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();

    // Prevent a destroyed-socket error from crashing the worker. Any
    // write() after the client bails can emit ERR_STREAM_WRITE_AFTER_END;
    // we treat that as a signal to stop, not to throw.
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

    // Detect *real* client disconnect — Node emits `close` on every
    // socket teardown including successful completion, so gate the
    // abort on a flag we clear right before we end the response.
    let clientDisconnected = false;
    const abortController = new AbortController();
    const onClientClose = () => {
      if (reply.raw.writableEnded) return;
      clientDisconnected = true;
      abortController.abort();
    };
    reply.raw.on("close", onClientClose);

    // Comment-frame heartbeat so proxies don't cut us off during a slow
    // generation. Cleared in finally whether we finish cleanly or not.
    const heartbeat = setInterval(() => {
      writeRaw(`: ping\n\n`);
    }, HEARTBEAT_MS);

    write("start", { model: SCAFFOLD_MODEL });

    let lastProgressAt = 0;

    try {
      const result = await this.ai.scaffoldProcessStream({
        description: dto.description,
        businessDocSchema: dto.businessDocSchema,
        tenantId: req.user.tenantId,
        userId: req.user.sub,
        abortSignal: abortController.signal,
        onProgress: (p) => {
          const now = Date.now();
          if (now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
          lastProgressAt = now;
          write("progress", p);
        },
      });
      write("complete", result);
    } catch (err) {
      // Client bailed — no point writing to a dead socket, and the
      // service has already suppressed persistence for user-aborts.
      if (clientDisconnected) {
        // Swallow silently; socket is gone.
      } else if (err instanceof HttpException) {
        write("error", { status: err.getStatus(), message: err.message });
      } else {
        this.logger.error("Unexpected error in scaffoldStream", (err as Error)?.stack);
        write("error", { status: 500, message: "Unexpected error." });
      }
    } finally {
      clearInterval(heartbeat);
      reply.raw.off("close", onClientClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  }
}
