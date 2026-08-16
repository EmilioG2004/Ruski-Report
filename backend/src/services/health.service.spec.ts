import { HealthService } from "./health.service";

describe("HealthService", () => {
  it("returns an ok health response", () => {
    const service = new HealthService();

    expect(service.getHealth()).toEqual({
      status: "ok",
      service: "ruski-report-backend"
    });
  });
});
