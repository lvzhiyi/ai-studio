import { EngineStoryboard } from './engine-port';
import { RunStore } from './run-store';

const story = 'STORY_SECRET_不要出现在查询结果里';

function input(file = 'agent-draft', step?: 'images') {
  return {
    story,
    characters: [{ name: '林夏', appearance: '短发' }],
    title: '雨夜',
    file,
    step,
  };
}

describe('RunStore', () => {
  it('创建和读取都不带故事正文', () => {
    const store = new RunStore();
    const created = store.create(input('第一集', 'images'));
    expect(created).toMatchObject({
      status: 'created',
      title: '雨夜',
      file: '第一集.json',
      step: 'images',
      tools: [],
      shotCount: null,
      job: null,
      storyboard: null,
    });
    expect(JSON.stringify(created)).not.toContain('STORY_SECRET');
    expect(JSON.stringify(store.get(created.id))).not.toContain('STORY_SECRET');
    expect(store.get('missing')).toBeUndefined();
  });

  it('非法文件名退回默认名；结束后丢掉原文，保留分镜产物', () => {
    const store = new RunStore();
    const created = store.create(input('../secret'));
    expect(created.file).toBe('agent-draft.json');
    expect(store.tryStart(created.id)).toBe('started');
    expect(store.tryStart(created.id)).toBe('conflict');
    expect(store.tryStart('missing')).toBe('missing');

    const storyboard: EngineStoryboard = {
      title: '雨夜',
      defaults: { voice: 'Vivian' },
      characters: {},
      shots: [{ id: 1, image: '画面', characters: [], line: '', duration: 3, motion: '运镜：固定' }],
    };
    store.noteTools(created.id, [{ name: 'draft_storyboard', ok: true, summary: '解析出 1 个镜头' }]);
    expect(store.get(created.id)?.tools).toHaveLength(1);

    store.finish(created.id, {
      status: 'succeeded',
      tools: [{ name: 'engine_handoff', ok: true, summary: '已交给引擎' }],
      storyboard,
      job: { id: 'job-1', status: 'queued', step: 'images' },
      file: 'agent-draft.json',
    });
    const view = store.get(created.id);
    expect(view).toMatchObject({
      status: 'succeeded',
      shotCount: 1,
      job: { id: 'job-1', step: 'images' },
      storyboard,
    });
    expect(store.readInput(created.id)?.story).toBe('');
    expect(JSON.stringify(view)).not.toContain('STORY_SECRET');
    expect(store.tryStart(created.id)).toBe('conflict');
  });

  it('超过上限时丢掉最老的非运行中记录，正在跑的留下', () => {
    const store = new RunStore();
    const running = store.create(input());
    expect(store.tryStart(running.id)).toBe('started');
    const disposable = store.create(input());
    for (let i = 0; i < RunStore.maxRuns; i++) store.create(input(`draft-${i}`));
    expect(store.get(running.id)?.status).toBe('running');
    expect(store.get(disposable.id)).toBeUndefined();
    expect(store.get('nope')).toBeUndefined();
  });
});
