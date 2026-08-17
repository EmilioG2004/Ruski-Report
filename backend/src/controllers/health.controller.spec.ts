import { HealthController } from "./health.controller";
import { HealthResponse, HealthService } from "../services/health.service";

describe("HealthController", () => {
  it("returns the service health response", async () => {
    const response: HealthResponse = {
      status: "ok",
      service: "ruski-report-backend",
      database: "ok"
    };
    const service = {
      getHealth: jest.fn().mockResolvedValue(response)
    } as unknown as HealthService;

    const controller = new HealthController(service);

    await expect(controller.getHealth()).resolves.toEqual(response);
    expect(service.getHealth).toHaveBeenCalledTimes(1);
  });
});
