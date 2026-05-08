import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { ValidationPipe, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/http-exception.filter";

const DEV_JWT_SECRET = "flowpro-dev-secret-key-change-in-production-min32";

function assertProductionConfig(config: ConfigService): void {
  if (config.get<string>("NODE_ENV") !== "production") return;

  const jwtSecret = config.get<string>("JWT_SECRET");
  if (!jwtSecret || jwtSecret === DEV_JWT_SECRET || jwtSecret.length < 32) {
    throw new Error(
      "Refusing to boot in production: JWT_SECRET is missing, the dev placeholder, or shorter than 32 chars.",
    );
  }

  const corsOrigin = config.get<string>("CORS_ORIGIN");
  if (!corsOrigin || corsOrigin.includes("localhost")) {
    throw new Error(
      "Refusing to boot in production: CORS_ORIGIN must be set to a non-localhost value.",
    );
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 5 * 1024 * 1024,
    }),
  );

  const config = app.get(ConfigService);
  assertProductionConfig(config);

  const port = config.get<number>("PORT", 3001);
  const corsOrigin = config.get<string>("CORS_ORIGIN", "http://localhost:5173");

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
  });

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  app.setGlobalPrefix("api");

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.enableShutdownHooks();

  await app.listen(port, "0.0.0.0");
  Logger.log(`FlowPro API running on http://localhost:${port}/api`, "Bootstrap");
}

bootstrap();
