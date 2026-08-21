import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { applyAdminSecurityHeaders } from "./admin/admin-security-headers";
import {
  createCorsOptions,
  loadHttpServerConfig
} from "./config/http-server.config";

async function bootstrap(): Promise<void> {
  const httpConfig = loadHttpServerConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.set(
    "trust proxy",
    httpConfig.trustedProxyHops === 0 ? false : httpConfig.trustedProxyHops
  );
  app.use(
    "/api/admin",
    (
      _request: unknown,
      response: { setHeader(name: string, value: string): unknown },
      next: () => void
    ) => {
      applyAdminSecurityHeaders(
        response,
        process.env.NODE_ENV === "production"
      );
      next();
    }
  );
  app.useBodyParser("json", { limit: httpConfig.requestBodyLimitBytes });
  app.useBodyParser("urlencoded", {
    extended: false,
    limit: httpConfig.requestBodyLimitBytes,
    parameterLimit: httpConfig.urlEncodedParameterLimit
  });
  app.enableCors(createCorsOptions(httpConfig.allowedOrigins));
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  const port = readPort(process.env.PORT);
  const host = process.env.HOST?.trim() || "0.0.0.0";
  await app.listen(port, host);
}

void bootstrap();

function readPort(value: string | undefined): number {
  const port = Number(value ?? 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, received '${value}'.`);
  }

  return port;
}
