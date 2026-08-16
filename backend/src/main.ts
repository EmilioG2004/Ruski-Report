import "reflect-metadata";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
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
