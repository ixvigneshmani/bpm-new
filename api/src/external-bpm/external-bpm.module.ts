import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExternalBpmController } from './external-bpm.controller';
import { ExternalBpmService } from './external-bpm.service';
import { WmIsService } from './wm-is.service';

@Module({
  imports: [AuthModule],
  controllers: [ExternalBpmController],
  providers: [ExternalBpmService, WmIsService],
})
export class ExternalBpmModule {}
