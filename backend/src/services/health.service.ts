import { Injectable } from "@nestjs/common";

import { PostgresDatabase } from "../database";

export interface HealthResponse {
  status: "ok";
  service: "ruski-report-backend";
  database: "ok";
}

@Injectable()
export class HealthService {
  constructor(private readonly database: PostgresDatabase) {}

  async getHealth(): Promise<HealthResponse> {
    await this.database.query("SELECT 1");

    return {
      status: "ok",
      service: "ruski-report-backend",
      database: "ok"
    };
  }
}
