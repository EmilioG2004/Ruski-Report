import {
  createCorsOptions,
  loadHttpServerConfig
} from "./http-server.config";

describe("loadHttpServerConfig", () => {
  it("uses restrictive defaults when no public browser origins are configured", () => {
    expect(loadHttpServerConfig({})).toEqual({
      allowedOrigins: [],
      trustedProxyHops: 0,
      requestBodyLimitBytes: 8_388_608,
      urlEncodedParameterLimit: 7_000,
      scorebookUploadLimitBytes: 10_485_760
    });
  });

  it("loads the production edge configuration", () => {
    expect(
      loadHttpServerConfig({
        CORS_ALLOWED_ORIGINS:
          "https://ruskireport.com/, https://www.ruskireport.com,https://ruskireport.com",
        HTTP_TRUST_PROXY_HOPS: "1",
        HTTP_REQUEST_BODY_LIMIT_BYTES: "4194304",
        HTTP_URLENCODED_PARAMETER_LIMIT: "6000",
        SCOREBOOK_UPLOAD_LIMIT_BYTES: "8388608"
      })
    ).toEqual({
      allowedOrigins: [
        "https://ruskireport.com",
        "https://www.ruskireport.com"
      ],
      trustedProxyHops: 1,
      requestBodyLimitBytes: 4_194_304,
      urlEncodedParameterLimit: 6_000,
      scorebookUploadLimitBytes: 8_388_608
    });
  });

  it.each([
    "*",
    "file:///tmp/test.html",
    "https://user:password@ruskireport.com",
    "https://ruskireport.com/path",
    "https://ruskireport.com?query=true"
  ])("rejects unsafe or non-origin CORS value %s", (origin) => {
    expect(() =>
      loadHttpServerConfig({ CORS_ALLOWED_ORIGINS: origin })
    ).toThrow("CORS");
  });

  it.each([
    ["HTTP_TRUST_PROXY_HOPS", "-1"],
    ["HTTP_TRUST_PROXY_HOPS", "1.5"],
    ["HTTP_REQUEST_BODY_LIMIT_BYTES", "0"],
    ["HTTP_URLENCODED_PARAMETER_LIMIT", "10001"],
    ["SCOREBOOK_UPLOAD_LIMIT_BYTES", "52428801"]
  ])("rejects invalid %s values", (name, value) => {
    expect(() => loadHttpServerConfig({ [name]: value })).toThrow(name);
  });
});

describe("createCorsOptions", () => {
  it("uses exact origins and does not enable browser credentials", () => {
    expect(createCorsOptions(["https://ruskireport.com"])).toMatchObject({
      origin: ["https://ruskireport.com"],
      credentials: false,
      maxAge: 86_400
    });
    expect(
      createCorsOptions(["https://ruskireport.com"]).allowedHeaders
    ).toContain("X-CSRF-Token");
  });
});
