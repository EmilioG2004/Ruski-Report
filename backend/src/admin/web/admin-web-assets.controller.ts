import { Controller, Get, Header } from "@nestjs/common";

import { ADMIN_WEB_CSS } from "./admin-web.styles";

@Controller("admin/app/assets")
export class AdminWebAssetsController {
  @Get("admin.css")
  @Header("Content-Type", "text/css; charset=utf-8")
  @Header("Cache-Control", "public, max-age=3600")
  stylesheet(): string {
    return ADMIN_WEB_CSS;
  }
}
