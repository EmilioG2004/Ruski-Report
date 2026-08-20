import { Server, IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import { once } from "node:events";

import { Test } from "@nestjs/testing";

import { loadAdministratorAuthConfig } from "../../config/admin-auth.config";
import { AppExceptionFilter } from "../../errors";
import { AppLogger } from "../../logging";
import {
  ADMIN_AUTH_CONFIG,
  AdministratorCsrfGuard,
  AdministratorSecurityAuditService,
  AdministratorSecurityService,
  AdministratorSessionGuard
} from "../security";
import {
  AdministratorSecurityTokens
} from "../security/administrator-security.tokens";
import {
  AdminTournamentSetupService,
  AdminTournamentsController
} from "../tournament-setup";
import { AdministratorWebExceptionFilter } from "./admin-web.errors";
import { AdminWebTournamentsController } from "./admin-web-tournaments.controller";

describe("administrator access request pipeline", () => {
  it("redirects protected HTML while protected setup JSON remains a 401 envelope", async () => {
    const securityAudit = {
      recordEvent: jest.fn().mockResolvedValue(undefined)
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AdminWebTournamentsController,
        AdminTournamentsController
      ],
      providers: [
        {
          provide: ADMIN_AUTH_CONFIG,
          useValue: loadAdministratorAuthConfig({})
        },
        {
          provide: AdministratorSecurityService,
          useValue: { authenticateSession: jest.fn() }
        },
        {
          provide: AdministratorSecurityAuditService,
          useValue: securityAudit
        },
        {
          provide: AdminTournamentSetupService,
          useValue: { list: jest.fn() }
        },
        AdministratorSessionGuard,
        {
          provide: AdministratorCsrfGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) }
        },
        {
          provide: AdministratorSecurityTokens,
          useValue: { matches: jest.fn(), hashOpaqueToken: jest.fn() }
        },
        AdministratorWebExceptionFilter
      ]
    }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AppExceptionFilter(LOGGER));
    await app.init();

    try {
      const server = app.getHttpServer() as Server;
      const html = await injectRequest(
        server,
        "/api/admin/app/tournaments"
      );
      const json = await injectRequest(server, "/api/admin/tournaments");

      expect(html.statusCode).toBe(303);
      expect(html.headers.location).toBe("/api/admin/app/sign-in");
      expect(json.statusCode).toBe(401);
      expect(json.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(json.body)).toMatchObject({
        code: "UNAUTHORIZED",
        details: [{ code: "ADMIN_AUTHENTICATION_REQUIRED" }]
      });
      expect(securityAudit.recordEvent).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});

interface InjectedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

async function injectRequest(
  server: Server,
  path: string
): Promise<InjectedResponse> {
  const socket = new CapturingSocket();
  const request = new IncomingMessage(socket as never);
  request.method = "GET";
  request.url = path;
  request.headers = { host: "localhost" };
  const response = new ServerResponse(request);
  response.assignSocket(socket as never);
  const finished = once(response, "finish");

  server.emit("request", request, response);
  await finished;
  return parseHttpResponse(socket.output());
}

function parseHttpResponse(raw: string): InjectedResponse {
  const [head = "", ...bodyParts] = raw.split("\r\n\r\n");
  const lines = head.split("\r\n");
  const statusCode = Number(lines.shift()?.split(" ")[1]);
  const headers = Object.fromEntries(lines.flatMap((line) => {
    const separator = line.indexOf(":");
    return separator < 0
      ? []
      : [[
          line.slice(0, separator).toLowerCase(),
          line.slice(separator + 1).trim()
        ]];
  }));
  return {
    statusCode,
    headers,
    body: bodyParts.join("\r\n\r\n")
  };
}

class CapturingSocket extends Duplex {
  readonly remoteAddress = "127.0.0.1";
  private readonly chunks: Buffer[] = [];

  override _read(): void {}

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  output(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

const LOGGER: AppLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn()
};
