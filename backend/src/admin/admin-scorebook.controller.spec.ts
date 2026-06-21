import { AppError } from "../errors";
import { AdminScorebookController } from "./admin-scorebook.controller";
import {
  AdminScorebookService,
  UploadedScorebookFile
} from "./admin-scorebook.service";

describe("AdminScorebookController", () => {
  it("delegates valid xlsx uploads to the scorebook service", async () => {
    const response = {
      uploadId: "upload-1",
      gameType: "ruski",
      source: {
        originalName: "scorebook.xlsx"
      },
      status: "published" as const,
      validation: {
        valid: true,
        errors: [],
        warnings: []
      },
      receivedAt: "2026-06-21T12:00:00.000Z"
    };
    const service = {
      uploadScorebook: jest.fn().mockResolvedValue(response)
    } as unknown as AdminScorebookService;
    const controller = new AdminScorebookController(service);
    const file = createFile();

    await expect(
      controller.uploadScorebook("2026", "ruski", file)
    ).resolves.toBe(response);
    expect(service.uploadScorebook).toHaveBeenCalledWith({
      year: 2026,
      gameType: "ruski",
      file
    });
  });

  it("rejects requests without a file", async () => {
    const controller = new AdminScorebookController(
      {} as unknown as AdminScorebookService
    );

    expect(() =>
      controller.uploadScorebook("2026", "ruski", undefined)
    ).toThrow(AppError);

    try {
      await controller.uploadScorebook("2026", "ruski", undefined);
      fail("Expected missing file to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("BAD_REQUEST");
    }
  });

  it("rejects requests with missing game type or non-xlsx files", () => {
    const controller = new AdminScorebookController(
      {} as unknown as AdminScorebookService
    );

    expect(() =>
      controller.uploadScorebook("2026", undefined, createFile())
    ).toThrow(AppError);
    expect(() =>
      controller.uploadScorebook("2026", "ruski", {
        ...createFile(),
        originalname: "scorebook.csv",
        mimetype: "text/csv"
      })
    ).toThrow(AppError);
  });
});

function createFile(): UploadedScorebookFile {
  return {
    buffer: Buffer.from("xlsx"),
    originalname: "scorebook.xlsx",
    mimetype:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 4
  };
}
