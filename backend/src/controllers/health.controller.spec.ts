import { HealthController } from "./health.controller";
import { HealthResponse, HealthService } from "../services/health.service";

describe("HealthController", () => {
  it("returns the service health response", () => {
    const response: HealthResponse = {
      status: "ok",
      service: "ruski-report-backend"
    };
    const service = {
      getHealth: jest.fn(() => response)
    } as unknown as HealthService;

    const controller = new HealthController(service);

    expect(controller.getHealth()).toEqual(response);
    expect(service.getHealth).toHaveBeenCalledTimes(1);
  });
});
