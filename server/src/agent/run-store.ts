import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EngineJobRef, EngineStep, EngineStoryboard, storyboardFileName } from './engine-port';
import { ToolTrace } from './tool-loop';

export interface RunInput {
  story: string;
  characters: Array<{ name: string; appearance?: string; outfit?: string; personality?: string }>;
  title: string;
  file: string;
  step?: EngineStep;
}

export interface RunView {
  id: string;
  status: 'created' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
  updatedAt: string;
  title: string;
  file: string;
  step: EngineStep | null;
  tools: ToolTrace[];
  shotCount: number | null;
  job: EngineJobRef | null;
  errorCode: string | null;
  storyboard: EngineStoryboard | null;
}

interface RunRecord extends RunView {
  /** 故事只在执行期间留在记录旁边，不进 RunView，避免查询接口把原文再带出去。 */
  story: string;
  characters: RunInput['characters'];
}

export interface RunFinish {
  status: 'succeeded' | 'failed';
  tools: ToolTrace[];
  errorCode?: string;
  storyboard?: EngineStoryboard;
  job?: EngineJobRef | null;
  file?: string;
}

/**
 * 进程内的 run 表。重启即丢，这是本切片刻意的：持久化和崩溃恢复留到队列那一步。
 * 上限 100，丢掉最老的非运行中记录，避免开发时长时间挂着把故事堆在内存里。
 */
@Injectable()
export class RunStore {
  static readonly maxRuns = 100;
  private readonly runs = new Map<string, RunRecord>();

  create(input: RunInput): RunView {
    const now = new Date().toISOString();
    const file = storyboardFileName(input.file) ?? 'agent-draft.json';
    const run: RunRecord = {
      id: randomUUID(),
      status: 'created',
      createdAt: now,
      updatedAt: now,
      title: input.title,
      file,
      step: input.step ?? null,
      tools: [],
      shotCount: null,
      job: null,
      errorCode: null,
      storyboard: null,
      story: input.story,
      characters: input.characters,
    };
    this.runs.set(run.id, run);
    this.trim();
    return this.view(run);
  }

  get(id: string): RunView | undefined {
    const run = this.runs.get(id);
    return run ? this.view(run) : undefined;
  }

  /** 同步把 created 改成 running。重复调用返回 conflict，避免两条 SSE 同时跑一轮循环。 */
  tryStart(id: string): 'missing' | 'conflict' | 'started' {
    const run = this.runs.get(id);
    if (!run) return 'missing';
    if (run.status !== 'created') return 'conflict';
    run.status = 'running';
    run.updatedAt = new Date().toISOString();
    return 'started';
  }

  readInput(id: string): RunInput | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    return {
      story: run.story,
      characters: run.characters,
      title: run.title,
      file: run.file,
      step: run.step ?? undefined,
    };
  }

  noteTools(id: string, tools: ToolTrace[]): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.tools = tools.map((tool) => ({ ...tool }));
    run.updatedAt = new Date().toISOString();
  }

  finish(id: string, patch: RunFinish): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.status = patch.status;
    run.updatedAt = new Date().toISOString();
    run.tools = patch.tools.map((tool) => ({ ...tool }));
    run.errorCode = patch.errorCode ?? null;
    run.storyboard = patch.storyboard ?? null;
    run.shotCount = patch.storyboard ? patch.storyboard.shots.length : null;
    run.job = patch.job ?? null;
    if (patch.file) run.file = patch.file;
    // 执行结束就丢掉原文。结果分镜仍然留着，那是这次 run 的产物。
    run.story = '';
    run.characters = [];
  }

  private trim(): void {
    if (this.runs.size <= RunStore.maxRuns) return;
    const victims = [...this.runs.values()]
      .filter((run) => run.status !== 'running')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    while (this.runs.size > RunStore.maxRuns && victims.length > 0) {
      this.runs.delete(victims.shift()!.id);
    }
  }

  private view(run: RunRecord): RunView {
    return {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      title: run.title,
      file: run.file,
      step: run.step,
      tools: run.tools.map((tool) => ({ ...tool })),
      shotCount: run.shotCount,
      job: run.job,
      errorCode: run.errorCode,
      storyboard: run.storyboard,
    };
  }
}
