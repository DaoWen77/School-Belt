import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [HealthController],
})
export class HealthModule {}
