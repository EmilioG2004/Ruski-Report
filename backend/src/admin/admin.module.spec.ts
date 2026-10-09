import { Test } from "@nestjs/testing";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";

import { AdminScorebookController } from "./admin-scorebook.controller";
import { AdminModule } from "./admin.module";
import { AdminTournamentWorkbooksController } from "./tournament-workbooks";

describe("AdminModule", () => {
  it("compiles with concrete upload providers", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AdminModule]
    }).compile();

    await moduleRef.close();
  });

  it("registers canonical workbooks without changing the legacy upload route", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AdminModule]
    }).compile();

    expect(moduleRef.get(AdminScorebookController)).toBeDefined();
    expect(moduleRef.get(AdminTournamentWorkbooksController)).toBeDefined();
    expect(Reflect.getMetadata(PATH_METADATA, AdminScorebookController))
      .toBe("admin/tournaments");
    expect(Reflect.getMetadata(
      PATH_METADATA,
      AdminScorebookController.prototype.uploadScorebook
    )).toBe(":year/upload-scorebook");
    expect(Reflect.getMetadata(
      METHOD_METADATA,
      AdminScorebookController.prototype.uploadScorebook
    )).toBe(RequestMethod.POST);

    await moduleRef.close();
  });
});
