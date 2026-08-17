import { HealthService } from "./health.service";
import { PostgresDatabase } from "../database";

describe("HealthService", () => {
  it("returns API and database readiness after PostgreSQL responds", async () => {
    const database = {
      query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] })
    } as unknown as PostgresDatabase;
    const service = new HealthService(database);

    await expect(service.getHealth()).resolves.toEqual({
      status: "ok",
      service: "ruski-report-backend",
      database: "ok"
    });
    expect(database.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("fails readiness when PostgreSQL is unavailable", async () => {
    const databaseError = new Error("database unavailable");
    const database = {
      query: jest.fn().mockRejectedValue(databaseError)
    } as unknown as PostgresDatabase;
    const service = new HealthService(database);

    await expect(service.getHealth()).rejects.toBe(databaseError);
  });
});
