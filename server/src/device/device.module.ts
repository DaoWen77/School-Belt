import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';

@Module({
  imports: [FilesModule],
  controllers: [DeviceController],
  providers: [DeviceService],
})
export class DeviceModule {}
