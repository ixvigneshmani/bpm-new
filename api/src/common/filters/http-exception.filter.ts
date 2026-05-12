import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { CorrelationContext } from "../observability/correlation-context";
import { captureException } from "../observability/sentry";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger?: PinoLogger) {
    // Logger is optional so existing tests that `new GlobalExceptionFilter()`
    // without DI still work; production wiring injects it.
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: "Internal server error" };

    const body = typeof message === "string" ? { statusCode: status, message } : message;

    // OS4 — surface the correlation id on the error response so a user
    // who hits an error can paste their request id back to support /
    // ops, who can then grep the structured logs for it. Also forward
    // 5xx (and unexpected non-HttpException errors) to Sentry with the
    // full request context.
    const corr = CorrelationContext.get();
    const enrichedBody = corr?.correlationId
      ? { ...(typeof body === "object" ? body : { message: body }), correlationId: corr.correlationId }
      : body;

    if (status >= 500 || !(exception instanceof HttpException)) {
      this.logger?.error(
        { err: exception, statusCode: status, route: corr?.route },
        "Unhandled exception",
      );
      captureException(exception, {
        correlationId: corr?.correlationId,
        tenantId: corr?.tenantId,
        userId: corr?.userId,
        route: corr?.route,
      });
    }

    if (corr?.correlationId && typeof reply.header === "function") {
      reply.header("X-Request-Id", corr.correlationId);
    }

    reply.status(status).send(enrichedBody);
  }
}
