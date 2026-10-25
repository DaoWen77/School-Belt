import { Module } from '@nestjs/common';
import { RtcController } from './rtc.controller';

@Module({ controllers: [RtcController] })
export class RtcModule {}
