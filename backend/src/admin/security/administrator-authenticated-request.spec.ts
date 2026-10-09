import {
  administratorRequestContext,
  safeAdministratorRequestId
} from "./administrator-authenticated-request";

describe("administrator request context", () => {
  it("keeps only UUID request identifiers", () => {
    const identifier = "123e4567-e89b-42d3-a456-426614174000";

    expect(safeAdministratorRequestId(identifier)).toBe(identifier);
    expect(safeAdministratorRequestId("attacker-controlled-value")).toBeUndefined();
    expect(administratorRequestContext({
      headers: { "x-request-id": "attacker-controlled-value" }
    })).not.toHaveProperty("requestId");
  });
});
