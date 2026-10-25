import { Module } from '@nestjs/common';
import { ChannelFilesController, FilesController } from './files.controller';
import { FilesService } from './files.service';
import { S3Service } from './s3.service';

@Module({
  controllers: [FilesController, ChannelFilesController],
  providers: [FilesService, S3Service],
  exports: [FilesService, S3Service],
})
export class FilesModule {}
