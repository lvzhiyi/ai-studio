import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { DramaRunService } from '../plugins/drama/drama-run.service';
import { ENGINE_ADAPTER } from './engine-port';
import { RunController } from './run.controller';
import { RunStore } from './run-store';
import { StudioEngineAdapter } from './studio-engine.adapter';

/** Agent 内核这一刀：内存 run、一轮工具循环、studio-engine 适配器。不在这里注册队列或别的引擎。 */
@Module({
  imports: [LlmModule],
  controllers: [RunController],
  providers: [
    RunStore,
    DramaRunService,
    { provide: ENGINE_ADAPTER, useClass: StudioEngineAdapter },
  ],
})
export class AgentModule {}
