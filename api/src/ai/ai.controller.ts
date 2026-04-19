import {
  Body,
  Controller,
  HttpException,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { ServerResponse } from "node:http";

/** Minimal structural type over the Fastify reply: we only touch `.raw`
 *  (the Node.js http.ServerResponse). Avoids adding `fastify` as an
 *  explicit dep just for one field. */
type StreamingReply = { raw: ServerResponse };
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { AiService } from "./ai.service";
import { ScaffoldProcessDto } from "./dto/scaffold-process.dto";

/** Minimum ms between `progress` events we push down the SSE stream.
 *  The underlying Anthropic callback fires on every input-json delta
 *  (dozens per second); clients only need a heartbeat, not a firehose. */
const PROGRESS_THROTTLE_MS = 200;

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

  /** POST /ai/scaffold-process-stream
   *  Same contract as /scaffold-process, but streams SSE:
   *    event: start   → { model }
   *    event: progress→ { charsOut, elapsedMs }   (throttled)
   *    event: complete→ <ScaffoldResult>          (sent once)
   *    event: error   → { status, message }       (mapped)
   *  The client keeps the HTTP POST (so auth + body work normally) and
   *  reads the response as a ReadableStream. Errors are *always* sent
   *  as SSE `error` events with a 200 status — the stream is already
   *  open by the time we know the outcome. */
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

    const write = (event: string, data: unknown): boolean => {
      if (reply.raw.writableEnded) return false;
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      return true;
    };

    // Detect client disconnect so the service can abort the Anthropic
    // call rather than stream tokens into a closed socket.
    const abortController = new AbortController();
    const onClientClose = () => abortController.abort();
    reply.raw.on("close", onClientClose);

    write("start", { model: "claude-sonnet-4-6" });

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
      if (err instanceof HttpException) {
        write("error", { status: err.getStatus(), message: err.message });
      } else {
        this.logger.error("Unexpected error in scaffoldStream", (err as Error)?.stack);
        write("error", { status: 500, message: "Unexpected error." });
      }
    } finally {
      reply.raw.off("close", onClientClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  }
}
