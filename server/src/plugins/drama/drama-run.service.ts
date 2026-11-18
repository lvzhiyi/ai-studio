import { Inject, Injectable, Optional } from '@nestjs/common';
import { ENGINE_ADAPTER, EngineAdapter } from '../../agent/engine-port';
import { RunFinish, RunInput, RunStore, RunView } from '../../agent/run-store';
import { LoopResult, runToolLoop, Tool, ToolLoopError, ToolTrace } from '../../agent/tool-loop';
import { LlmService } from '../../llm/llm.service';
import { bagWithInput, createDramaTools, DramaBag } from './drama.tools';

export interface RunResultBody {
  file: string;
  shotCount: number;
  job: RunView['job'];
  storyboard: NonNullable<RunView['storyboard']>;
}

export const RUN_TOOLS = Symbol('RUN_TOOLS');

type Send = (event: string, data: unknown) => void;

/**
 * 把一次 run 跑完一轮 drama 计划。
 * 故事正文只留在 store 的执行期副本里；发出去的 tool 事件只有工具名和一句摘要。
 */
@Injectable()
export class DramaRunService {
  constructor(
    private readonly store: RunStore,
    private readonly llm: LlmService,
    @Inject(ENGINE_ADAPTER) private readonly engine: EngineAdapter,
    /** 测试替换计划。生产不注册这个 token，走 createDramaTools。 */
    @Optional() @Inject(RUN_TOOLS) private readonly toolsOverride?: Array<Tool<DramaBag>>,
  ) {}

  create(input: RunInput): RunView {
    return this.store.create(input);
  }

  get(id: string): RunView | undefined {
    return this.store.get(id);
  }

  /**
   * 调用前必须已经 tryStart。成功时返回要写进 `result` 事件的产物；
   * 失败时先落盘再抛 ToolLoopError，由 SSE 层只把 code 写出去。
   * 客户端取消时落成 cancelled 并正常返回，避免对已断开的响应再写 error。
   */
  async execute(id: string, send: Send, signal: AbortSignal): Promise<RunResultBody | void> {
    const input = this.store.readInput(id);
    if (!input) throw new ToolLoopError('internal_error');

    send('status', { status: 'running' });
    const bag = bagWithInput(input);
    const trace: ToolTrace[] = [];
    let outcome: LoopResult;
    try {
      outcome = await runToolLoop(this.toolsOverride ?? createDramaTools(this.llm, this.engine), {
        signal,
        bag,
        emit: (event) => {
          send('tool', event);
          if (event.phase === 'end' && event.ok !== undefined && event.summary !== undefined) {
            trace.push({ name: event.name, ok: event.ok, summary: event.summary });
            this.store.noteTools(id, trace);
          }
        },
      });
    } catch (error) {
      const code = error instanceof ToolLoopError ? error.code : 'internal_error';
      this.persist(id, trace, bag, 'failed', code);
      if (code === 'cancelled' || signal.aborted) return;
      throw error instanceof ToolLoopError ? error : new ToolLoopError(code);
    }

    if (!outcome.ok) {
      const code = outcome.errorCode ?? 'internal_error';
      this.persist(id, outcome.tools, bag, 'failed', code);
      if (code === 'cancelled' || signal.aborted) return;
      throw new ToolLoopError(code);
    }

    if (!bag.storyboard || !bag.handoff) {
      this.persist(id, outcome.tools, bag, 'failed', 'internal_error');
      throw new ToolLoopError('internal_error');
    }
    this.persist(id, outcome.tools, bag, 'succeeded');
    return {
      file: bag.handoff.file,
      shotCount: bag.handoff.shotCount,
      job: bag.handoff.job,
      storyboard: bag.storyboard,
    };
  }

  private persist(
    id: string,
    tools: ToolTrace[],
    bag: DramaBag,
    status: RunFinish['status'],
    errorCode?: string,
  ): void {
    this.store.finish(id, {
      status,
      tools,
      errorCode,
      storyboard: bag.storyboard,
      job: bag.handoff?.job ?? null,
      file: bag.handoff?.file,
    });
  }
}
