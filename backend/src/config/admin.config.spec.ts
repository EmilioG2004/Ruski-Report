import { loadAdminConfig } from "./admin.config";

describe("loadAdminConfig", () => {
  it("prefers the general admin token and trims operator configuration", () => {
    expect(
      loadAdminConfig({
        ADMIN_API_TOKEN: " api-token ",
        ADMIN_UPLOAD_TOKEN: "legacy-token",
        MODERATION_OPERATOR_ID: " operator-1 "
      })
    ).toEqual({
      apiToken: "api-token",
      operatorId: "operator-1"
    });
  });

  it("supports the legacy upload token and safe operator default", () => {
    expect(
      loadAdminConfig({ ADMIN_UPLOAD_TOKEN: "legacy-token" })
    ).toEqual({
      apiToken: "legacy-token",
      operatorId: "tournament-operator"
    });
  });

  it("treats blank secrets as unconfigured", () => {
    expect(loadAdminConfig({ ADMIN_API_TOKEN: "  " }).apiToken).toBeUndefined();
  });
});
