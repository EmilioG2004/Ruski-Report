import { writeJson, writeOptionalJson } from "./postgres-values";

describe("PostgreSQL JSON values", () => {
  it("serializes array roots as JSON rather than PostgreSQL array literals", () => {
    expect(writeJson([{ label: "Wins", value: 3 }])).toBe(
      '[{"label":"Wins","value":3}]'
    );
  });

  it("preserves nullable JSON values", () => {
    expect(writeOptionalJson(undefined)).toBeNull();
    expect(writeOptionalJson(null)).toBeNull();
    expect(writeOptionalJson([])).toBe("[]");
  });

  it("rejects values that JSON cannot represent", () => {
    expect(() => writeJson(undefined)).toThrow(
      "PostgreSQL JSON values must be JSON-serializable."
    );
  });
});
