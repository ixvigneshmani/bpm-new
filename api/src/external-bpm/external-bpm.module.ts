import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExternalBpmController } from './external-bpm.controller';
import { ExternalBpmService } from './external-bpm.service';

@Module({
  imports: [AuthModule],
  controllers: [ExternalBpmController],
  providers: [ExternalBpmService],
})
export class ExternalBpmModule {}
