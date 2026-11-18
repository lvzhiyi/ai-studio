import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EngineError, EngineStoryboard } from './engine-port';
import { StudioEngineAdapter } from './studio-engine.adapter';

const marker = 'MARKER_画面正文不进日志';

const storyboard: EngineStoryboard = {
  title: '雨夜',
  defaults: { voice: 'Vivian' },
  characters: { c1: { name: '林夏', look: '角色：林夏' } },
  shots: [{ id: 1, image: marker, characters: ['c1'], line: '', duration: 3, motion: '运镜：固定' }],
};

function adapter(env: Record<string, string | undefined> = { ENGINE_BASE_URL: 'http://engine.test' }) {
  return new StudioEngineAdapter(new ConfigService(env));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('StudioEngineAdapter', () => {
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  let warn: jest.SpiedFunction<Logger['warn']>;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('探活、创建、保存，并按白名单提交步骤；响应正文不进日志', async () => {
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ file: '分镜.json' }, 201))
      .mockResolvedValueOnce(json({ data: { shots: [], image: marker } }))
      .mockResolvedValueOnce(json({ id: 'job-9', status: 'queued', command: `studio run ${marker}` }));

    const result = await adapter({ ENGINE_BASE_URL: 'http://engine.test/', ENGINE_TIMEOUT_MS: '0' }).handoff(
      { file: '分镜', title: '雨夜', storyboard, step: 'images' },
      new AbortController().signal,
    );

    expect(result).toEqual({
      file: '分镜.json',
      shotCount: 1,
      job: { id: 'job-9', status: 'queued', step: 'images' },
    });
    const [probe, create, save, job] = fetchMock.mock.calls;
    expect(probe[0]).toBe('http://engine.test/api/storyboards');
    expect(probe[1]?.method).toBe('GET');
    expect(probe[1]?.body).toBeUndefined();
    expect(create[0]).toBe('http://engine.test/api/storyboards');
    expect(JSON.parse(String(create[1]?.body))).toEqual({ file: '分镜.json', title: '雨夜' });
    expect(save[0]).toBe(`http://engine.test/api/storyboards/${encodeURIComponent('分镜.json')}`);
    expect(JSON.parse(String(save[1]?.body))).toEqual({ data: storyboard });
    expect(JSON.parse(String(job[1]?.body))).toEqual({
      kind: 'run',
      file: '分镜.json',
      options: { only: 'images' },
    });
    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers.authorization).toBeUndefined();
      expect(headers.accept).toBe('application/json');
    }
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
  });

  it.each([
    ['audio', { kind: 'run', options: { only: 'audio' } }],
    ['cast', { kind: 'cast', options: {} }],
    ['qa', { kind: 'qa', options: {} }],
  ] as const)('步骤 %s 使用引擎白名单', async (step, expected) => {
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ file: 'agent-draft.json' }, 201))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ id: 'job-1', status: 'queued' }));
    await adapter().handoff({ file: 'agent-draft.json', title: '雨夜', storyboard, step }, new AbortController().signal);
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({
      kind: expected.kind,
      file: 'agent-draft.json',
      options: expected.options,
    });
  });

  it('不提交步骤时只保存；同名分镜表改为覆盖', async () => {
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ error: `已经有同名分镜表，${marker}` }, 400))
      .mockResolvedValueOnce(json({ data: { image: marker } }));
    const saved = await adapter().handoff(
      { file: 'agent-draft', title: '雨夜', storyboard },
      new AbortController().signal,
    );
    expect(saved.job).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('引擎拒绝或没有任务 id 时只记录状态码', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: marker }, 500));
    await expect(adapter().handoff({ file: 'agent-draft', title: '雨夜', storyboard }, new AbortController().signal)).rejects.toEqual(
      new EngineError('engine_rejected'),
    );
    expect(warn).toHaveBeenCalledWith('引擎探活失败：500');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);

    warn.mockClear();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ error: marker }, 400));
    await expect(adapter().handoff({ file: 'agent-draft', title: '雨夜', storyboard }, new AbortController().signal)).rejects.toEqual(
      new EngineError('engine_rejected'),
    );
    expect(warn).toHaveBeenCalledWith('引擎创建分镜表失败：400');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    warn.mockClear();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({}, 201))
      .mockResolvedValueOnce(json({ error: marker }, 422));
    await expect(adapter().handoff({ file: 'agent-draft', title: '雨夜', storyboard, step: 'images' }, new AbortController().signal)).rejects.toEqual(
      new EngineError('engine_rejected'),
    );
    expect(warn).toHaveBeenCalledWith('引擎保存分镜表失败：422');

    warn.mockClear();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({}, 201))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ id: '', status: 'queued' }));
    await expect(adapter().handoff({ file: 'agent-draft', title: '雨夜', storyboard, step: 'qa' }, new AbortController().signal)).rejects.toEqual(
      new EngineError('engine_rejected'),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('网络失败、超时、调用方取消和非法参数', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`connect ${marker}`));
    await expect(adapter().handoff({ file: 'agent-draft', title: '雨夜', storyboard }, new AbortController().signal)).rejects.toEqual(
      new EngineError('engine_unavailable'),
    );
    expect(warn).toHaveBeenCalledWith('引擎请求失败：GET /api/storyboards network');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);

    warn.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener('abort', abort);
      });
    });
    await expect(
      adapter({ ENGINE_BASE_URL: 'http://127.0.0.1:8780', ENGINE_TIMEOUT_MS: '1' }).handoff(
        { file: 'agent-draft', title: '雨夜', storyboard },
        new AbortController().signal,
      ),
    ).rejects.toEqual(new EngineError('engine_unavailable'));
    expect(warn.mock.calls[0][0]).toContain('timeout');

    warn.mockClear();
    const userAbort = new AbortController();
    userAbort.abort();
    await expect(adapter().handoff({ file: 'agent-draft', title: '雨夜', storyboard }, userAbort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(warn).not.toHaveBeenCalled();

    fetchMock.mockReset();
    await expect(
      adapter().handoff({ file: '../secret', title: '雨夜', storyboard }, new AbortController().signal),
    ).rejects.toEqual(new EngineError('engine_rejected'));
    await expect(
      adapter().handoff({ file: 'agent-draft', title: '雨夜', storyboard, step: 'video' as 'images' }, new AbortController().signal),
    ).rejects.toEqual(new EngineError('engine_rejected'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('任务响应不是 JSON 时拒绝', async () => {
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({}, 201))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }));
    await expect(
      adapter().handoff({ file: 'agent-draft', title: '雨夜', storyboard, step: 'cast' }, new AbortController().signal),
    ).rejects.toEqual(new EngineError('engine_rejected'));
  });
});
