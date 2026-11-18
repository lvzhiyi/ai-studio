import { Body, ConflictException, Controller, Get, Logger, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DramaRunService } from '../plugins/drama/drama-run.service';
import { CreateRunDto } from './run.dto';
import { RunInput, RunStore } from './run-store';
import { pipeRun } from './run-sse';

/** 最小 run：创建、读取、用 SSE 跑一轮工具循环。不做登录，限流仍走全局设备/IP 守卫。 */
@Controller('runs')
export class RunController {
  private readonly logger = new Logger(RunController.name);

  constructor(
    private readonly store: RunStore,
    private readonly runs: DramaRunService,
  ) {}

  @Post()
  create(@Body() body: CreateRunDto) {
    return this.runs.create(toInput(body));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const run = this.runs.get(id);
    if (!run) throw new NotFoundException();
    return run;
  }

  @Post(':id/stream')
  stream(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const started = this.store.tryStart(id);
    if (started === 'missing') throw new NotFoundException();
    if (started === 'conflict') throw new ConflictException();
    return pipeRun(res, this.logger, 15_000, async (send, signal) => {
      const result = await this.runs.execute(id, send, signal);
      if (!result) return;
      send('result', result);
      send('done', { status: 'succeeded' });
    });
  }
}

function toInput(body: CreateRunDto): RunInput {
  return {
    story: body.story,
    characters: (body.characters ?? []).map((character) => ({
      name: character.name,
      appearance: character.appearance,
      outfit: character.outfit,
      personality: character.personality,
    })),
    title: body.title?.trim() || '未命名',
    file: body.file?.trim() || 'agent-draft',
    step: body.step,
  };
}
