import {
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards
} from "@nestjs/common";

import { AuthSessionGuard, CurrentPrincipal } from "../auth";
import { AuthenticatedPrincipal, BlockedUser } from "../domain";
import {
  BlockUserReceipt,
  UnblockUserReceipt,
  UserBlockingService
} from "./user-blocking.service";

@Controller("account/blocks")
@UseGuards(AuthSessionGuard)
export class UserBlockingController {
  constructor(private readonly blocking: UserBlockingService) {}

  @Get()
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<BlockedUser[]> {
    return this.blocking.list(principal);
  }

  @Put(":userId")
  block(
    @Param("userId") userId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<BlockUserReceipt> {
    return this.blocking.block(userId, principal);
  }

  @Delete(":userId")
  unblock(
    @Param("userId") userId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<UnblockUserReceipt> {
    return this.blocking.unblock(userId, principal);
  }
}
