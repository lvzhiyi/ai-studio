import { EngineStoryboard } from '../../agent/engine-port';
import { RunStore } from '../../agent/run-store';
import { Tool, ToolLoopError } from '../../agent/tool-loop';
import { LlmService } from '../../llm/llm.service';
import { MockEngineAdapter } from '../../testing/mock-engine';
import { DramaRunService } from './drama-run.service';
import { DramaBag } from './drama.tools';

const story = 'STORY_SECRET_服务不该把它写进结果';

const storyboard: EngineStoryboard = {
  title: '雨夜',
  defaults: { voice: 'Vivian' },
  characters: {},
  shots: [{ id: 1, image: '画面', characters: [], line: '', duration: 3, motion: '运镜：固定' }],
};

function service(tools: Array<Tool<DramaBag>>) {
  const store = new RunStore();
  const runs = new DramaRunService(store, {} as LlmService, new MockEngineAdapter(), tools);
  return { runs, store };
}

describe('DramaRunService', () => {
  it('创建结果不含原文；一轮成功后能读到分镜和任务', async () => {
    const events: unknown[] = [];
    const { runs, store } = service([
      {
        name: 'draft_storyboard',
        async execute(ctx) {
          ctx.bag.storyboard = storyboard;
          return { ok: true, summary: '解析出 1 个镜头' };
        },
      },
      {
        name: 'engine_handoff',
        async execute(ctx) {
          ctx.bag.handoff = { file: 'agent-draft.json', shotCount: 1, job: { id: 'job-1', status: 'queued', step: 'images' } };
          return { ok: true, summary: '已交给引擎，1 个镜头，已提交 images 步骤' };
        },
      },
    ]);
    const created = runs.create({ story, characters: [], title: '雨夜', file: 'agent-draft', step: 'images' });
    expect(JSON.stringify(created)).not.toContain('STORY_SECRET');
    expect(runs.get(created.id)?.status).toBe('created');

    expect(store.tryStart(created.id)).toBe('started');
    const result = await runs.execute(created.id, (_event, data) => events.push(data), new AbortController().signal);
    expect(result).toMatchObject({ file: 'agent-draft.json', shotCount: 1, job: { id: 'job-1', step: 'images' } });
    expect(runs.get(created.id)).toMatchObject({ status: 'succeeded', shotCount: 1, errorCode: null });
    expect(JSON.stringify(runs.get(created.id))).not.toContain('STORY_SECRET');
    expect(events).toEqual([
      { status: 'running' },
      { name: 'draft_storyboard', phase: 'start' },
      { name: 'draft_storyboard', phase: 'end', ok: true, summary: '解析出 1 个镜头' },
      { name: 'engine_handoff', phase: 'start' },
      { name: 'engine_handoff', phase: 'end', ok: true, summary: '已交给引擎，1 个镜头，已提交 images 步骤' },
    ]);
  });

  it('工具失败时留下已解析的分镜并抛出错误码', async () => {
    const { runs, store } = service([
      {
        name: 'draft_storyboard',
        async execute(ctx) {
          ctx.bag.storyboard = storyboard;
          return { ok: false, summary: '引擎未接受分镜', errorCode: 'engine_rejected' };
        },
      },
    ]);
    const created = runs.create({ story, characters: [], title: '雨夜', file: 'agent-draft' });
    store.tryStart(created.id);
    await expect(runs.execute(created.id, () => undefined, new AbortController().signal)).rejects.toEqual(
      new ToolLoopError('engine_rejected'),
    );
    expect(runs.get(created.id)).toMatchObject({ status: 'failed', errorCode: 'engine_rejected', storyboard });
  });

  it('计划没有产物、工具抛错、取消、找不到 run', async () => {
    const empty = service([]);
    const created = empty.runs.create({ story, characters: [], title: '雨夜', file: 'agent-draft' });
    empty.store.tryStart(created.id);
    await expect(empty.runs.execute(created.id, () => undefined, new AbortController().signal)).rejects.toEqual(
      new ToolLoopError('internal_error'),
    );

    const broken = service([
      {
        name: 'boom',
        execute() {
          throw new Error('boom-secret');
        },
      },
    ]);
    const second = broken.runs.create({ story, characters: [], title: '雨夜', file: 'agent-draft' });
    broken.store.tryStart(second.id);
    await expect(broken.runs.execute(second.id, () => undefined, new AbortController().signal)).rejects.toEqual(
      new ToolLoopError('internal_error'),
    );
    expect(JSON.stringify(broken.runs.get(second.id))).not.toContain('boom-secret');

    const aborting = new AbortController();
    const waiting = service([
      {
        name: 'draft_storyboard',
        execute(ctx) {
          return new Promise((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
        },
      },
    ]);
    const third = waiting.runs.create({ story, characters: [], title: '雨夜', file: 'agent-draft' });
    waiting.store.tryStart(third.id);
    const pending = waiting.runs.execute(third.id, () => undefined, aborting.signal);
    aborting.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(waiting.runs.get(third.id)?.errorCode).toBe('cancelled');

    const already = new AbortController();
    already.abort();
    const fourth = waiting.runs.create({ story, characters: [], title: '雨夜', file: 'agent-draft' });
    waiting.store.tryStart(fourth.id);
    await expect(waiting.runs.execute(fourth.id, () => undefined, already.signal)).resolves.toBeUndefined();
    expect(waiting.runs.get(fourth.id)?.errorCode).toBe('cancelled');

    await expect(waiting.runs.execute('missing', () => undefined, new AbortController().signal)).rejects.toEqual(
      new ToolLoopError('internal_error'),
    );
  });

  it('工具声称成功但没有交出分镜时记内部错误', async () => {
    const { runs, store } = service([{ name: 'noop', async execute() { return { ok: true, summary: 'ok' }; } }]);
    const created = runs.create({ story, characters: [], title: '雨夜', file: 'agent-draft' });
    store.tryStart(created.id);
    await expect(runs.execute(created.id, () => undefined, new AbortController().signal)).rejects.toEqual(
      new ToolLoopError('internal_error'),
    );
    expect(runs.get(created.id)?.status).toBe('failed');
  });
});
