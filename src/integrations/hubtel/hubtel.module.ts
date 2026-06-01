import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HubtelService } from './hubtel.service';

@Module({
  imports: [HttpModule],
  providers: [HubtelService],
  exports: [HubtelService],
})
export class HubtelModule {}
