import { Injectable } from "@nestjs/common";

export interface HealthResponse {
  status: "ok";
  service: "ruski-report-backend";
}

@Injectable()
export class HealthService {
  getHealth(): HealthResponse {
    return {
      status: "ok",
      service: "ruski-report-backend"
    };
  }
}
