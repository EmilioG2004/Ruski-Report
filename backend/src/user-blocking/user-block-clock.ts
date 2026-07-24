import { Injectable } from "@nestjs/common";

export const USER_BLOCK_CLOCK = Symbol("USER_BLOCK_CLOCK");

export interface UserBlockClock {
  now(): Date;
}

@Injectable()
export class SystemUserBlockClock implements UserBlockClock {
  now(): Date {
    return new Date();
  }
}
