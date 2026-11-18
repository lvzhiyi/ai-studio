import { EngineError, EngineStoryboard } from '../../agent/engine-port';
import { RunInput } from '../../agent/run-store';
import { LlmService, UpstreamError } from '../../llm/llm.service';
import { MockEngineAdapter } from '../../testing/mock-engine';
import { bagWithInput, createDramaTools, DramaBag } from './drama.tools';

const scene = 'SCENE_摘要里不该出现的画面';

const input: RunInput = {
  story: 'STORY_SECRET_工具摘要里不该出现',
  characters: [{ name: '林夏', appearance: '短发' }],
  title: '雨夜',
  file: 'agent-draft',
  step: 'images',
};

function bag(): DramaBag {
  return bagWithInput(input);
}

describe('drama 工具', () => {
  const engine = new MockEngineAdapter();
  const signal = new AbortController().signal;

  beforeEach(() => {
    engine.calls.length = 0;
    engine.error = null;
  });

  it('起草后交给引擎，摘要和适配器入参都不带故事正文或 run', async () => {
    const llm = {
      streamStoryboard: async function* () {
        yield JSON.stringify({ scene, characters: ['林夏'], cameraMove: '推', durationSec: 2 });
        yield ',\n';
      },
    } as unknown as LlmService;
    const [draft, handoff] = createDramaTools(llm, engine);
    const state = bag();
    const drafted = await draft.execute({ signal, bag: state, emit: () => undefined });
    expect(drafted).toEqual({ ok: true, summary: '解析出 1 个镜头' });
    expect(drafted.summary).not.toContain('SCENE_摘要');
    expect(state.storyboard?.shots[0].image).toBe(scene);

    const saved = await handoff.execute({ signal, bag: state, emit: () => undefined });
    expect(saved.ok).toBe(true);
    expect(saved.summary).toContain('已提交 images 步骤');
    expect(saved.summary).not.toContain('SCENE_摘要');
    expect(saved.summary).not.toContain('STORY_SECRET');
    expect(engine.calls[0]).toEqual({
      file: 'agent-draft',
      title: '雨夜',
      storyboard: state.storyboard,
      step: 'images',
    });
    expect(engine.calls[0]).not.toHaveProperty('runId');
  });

  it('只保存时不编造任务', async () => {
    const state = bag();
    state.input = { ...input, step: undefined };
    state.storyboard = storyboard();
    const handoff = createDramaTools({} as LlmService, engine)[1];
    const saved = await handoff.execute({ signal, bag: state, emit: () => undefined });
    expect(saved.summary).toContain('仅保存');
    expect(engine.calls[0].step).toBeUndefined();
  });

  it('起草失败时不调用引擎', async () => {
    const cases: Array<[unknown, string]> = [
      [new UpstreamError(502), 'upstream_error'],
      [new Error('上游把故事原文放进了异常'), 'internal_error'],
    ];
    for (const [error, code] of cases) {
      const llm = {
        streamStoryboard: async function* () {
          throw error;
        },
      } as unknown as LlmService;
      const drafted = await createDramaTools(llm, engine)[0].execute({ signal, bag: bag(), emit: () => undefined });
      expect(drafted.ok).toBe(false);
      expect(drafted.errorCode).toBe(code);
      expect(drafted.summary).not.toContain('故事原文');
    }
    const invalid = {
      streamStoryboard: async function* () {
        yield '不是分镜';
      },
    } as unknown as LlmService;
    const drafted = await createDramaTools(invalid, engine)[0].execute({ signal, bag: bag(), emit: () => undefined });
    expect(drafted.errorCode).toBe('invalid_storyboard');

    const huge = {
      streamStoryboard: async function* () {
        yield 'x'.repeat(200_001);
      },
    } as unknown as LlmService;
    const tooLong = await createDramaTools(huge, engine)[0].execute({ signal, bag: bag(), emit: () => undefined });
    expect(tooLong).toMatchObject({ ok: false, errorCode: 'invalid_storyboard' });
    expect(engine.calls).toHaveLength(0);
  });

  it('引擎失败、缺少分镜、非预期异常和取消', async () => {
    const handoff = createDramaTools({} as LlmService, engine)[1];
    const missing = await handoff.execute({ signal, bag: bag(), emit: () => undefined });
    expect(missing).toMatchObject({ ok: false, errorCode: 'internal_error' });

    const state = bag();
    state.storyboard = storyboard();
    engine.error = new EngineError('engine_unavailable');
    const rejected = await handoff.execute({ signal, bag: state, emit: () => undefined });
    expect(rejected.errorCode).toBe('engine_unavailable');

    engine.error = new Error('socket hang up');
    const unknown = await handoff.execute({ signal, bag: state, emit: () => undefined });
    expect(unknown.errorCode).toBe('engine_unavailable');
    expect(unknown.summary).not.toContain('socket');

    const aborted = new AbortController();
    aborted.abort();
    engine.error = null;
    await expect(handoff.execute({ signal: aborted.signal, bag: state, emit: () => undefined })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

function storyboard(): EngineStoryboard {
  return {
    title: '雨夜',
    defaults: { voice: 'Vivian' },
    characters: {},
    shots: [{ id: 1, image: scene, characters: [], line: '', duration: 3, motion: '运镜：固定' }],
  };
}
