import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { LlmService, UpstreamError } from '../llm/llm.service';
import { MockEngineAdapter } from '../testing/mock-engine';
import { ENGINE_ADAPTER, EngineError } from './engine-port';

/**
 * 跑真实 HTTP 和 SSE。模型和引擎都换成假的，不联网、不提交出图。
 */
describe('agent run', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let llm: { streamStoryboard: jest.Mock };
  let engine: MockEngineAdapter;
  let deviceSeq = 0;
  const nextDevice = () => `00000000-0000-4000-8000-${String(++deviceSeq).padStart(12, '0')}`;
  const story = 'STORY_SECRET_创建和查询都不该回显这段话';

  const post = (path: string, body: unknown, device = nextDevice()) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': device },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    llm = { streamStoryboard: jest.fn() };
    engine = new MockEngineAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService)
      .useValue(llm)
      .overrideProvider(ENGINE_ADAPTER)
      .useValue(engine)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    llm.streamStoryboard.mockReset();
    engine.calls.length = 0;
    engine.error = null;
  });

  it('创建 run、流式跑完一轮、再读到对齐后的分镜和假出图步骤', async () => {
    llm.streamStoryboard.mockImplementation(async function* () {
      yield JSON.stringify({
        shotSize: '全景',
        scene: '雨夜的老街',
        dialogue: '',
        characters: ['林夏'],
        cameraMove: '拉',
        durationSec: 3,
        props: [{ name: '伞', owner: '林夏' }],
      });
      yield '\n';
    });
    const device = nextDevice();
    const created = await post('/runs', {
      story,
      title: '雨夜',
      file: 'agent-draft',
      step: 'images',
      characters: [{ name: '林夏', appearance: '齐肩短发' }],
      extra: '丢掉',
    }, device);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string };
    expect(JSON.stringify(body)).not.toContain('STORY_SECRET');

    const streamed = await post(`/runs/${body.id}/stream`, {}, device);
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get('content-type')).toContain('text/event-stream');
    expect(streamed.headers.get('x-accel-buffering')).toBe('no');
    const text = await streamed.text();
    expect(text).toContain('event: status\ndata: {"status":"running"}');
    expect(text).toContain('"name":"draft_storyboard"');
    expect(text).toContain('"name":"engine_handoff"');
    expect(text).toContain('event: done\ndata: {"status":"succeeded"}');
    expect(text).toContain('雨夜的老街');
    expect(text).toContain('"step":"images"');
    expect(text).not.toContain('STORY_SECRET');
    expect(text).not.toContain('"props"');

    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]).not.toHaveProperty('runId');
    expect(JSON.stringify(engine.calls[0])).not.toContain(body.id);
    expect(engine.calls[0].storyboard.characters.c1).toEqual({ name: '林夏', look: '齐肩短发' });

    const reader = nextDevice();
    const view = await fetch(`${baseUrl}/runs/${body.id}`, { headers: { 'x-device-id': reader } });
    expect(await view.json()).toMatchObject({
      id: body.id,
      status: 'succeeded',
      file: 'agent-draft.json',
      step: 'images',
      shotCount: 1,
      job: { id: 'job-mock', status: 'queued', step: 'images' },
      errorCode: null,
    });

    expect((await post(`/runs/${body.id}/stream`, {}, device)).status).toBe(409);
  });

  it('引擎拒绝时流式返回错误码，草稿分镜仍可读取', async () => {
    llm.streamStoryboard.mockImplementation(async function* () {
      yield '{"scene":"雨夜的老街"}\n';
    });
    engine.error = new EngineError('engine_unavailable');
    const device = nextDevice();
    const created = (await (await post('/runs', { story, step: 'images' }, device)).json()) as { id: string };
    const text = await (await post(`/runs/${created.id}/stream`, {}, device)).text();
    expect(text).toContain('event: error\ndata: {"code":"engine_unavailable"}');
    expect(text).not.toContain('event: done');
    const view = (await (await fetch(`${baseUrl}/runs/${created.id}`, { headers: { 'x-device-id': device } })).json()) as {
      status: string;
      errorCode: string;
      storyboard: { shots: unknown[] };
    };
    expect(view.status).toBe('failed');
    expect(view.errorCode).toBe('engine_unavailable');
    expect(view.storyboard.shots).toHaveLength(1);
  });

  it('分镜对不齐或上游失败时不调用引擎', async () => {
    llm.streamStoryboard.mockImplementation(async function* () {
      yield '不是 json';
    });
    const invalidDevice = nextDevice();
    const invalid = (await (await post('/runs', { story }, invalidDevice)).json()) as { id: string };
    expect(await (await post(`/runs/${invalid.id}/stream`, {}, invalidDevice)).text()).toContain('{"code":"invalid_storyboard"}');
    expect(engine.calls).toHaveLength(0);

    llm.streamStoryboard.mockImplementation(async function* () {
      throw new UpstreamError(502);
    });
    const upstreamDevice = nextDevice();
    const upstream = (await (await post('/runs', { story }, upstreamDevice)).json()) as { id: string };
    expect(await (await post(`/runs/${upstream.id}/stream`, {}, upstreamDevice)).text()).toContain('{"code":"upstream_error"}');
    expect(engine.calls).toHaveLength(0);
  });

  it('参数不合法、run 不存在时拒绝', async () => {
    const device = nextDevice();
    expect((await post('/runs', { story: '太短' }, device)).status).toBe(400);
    expect((await post('/runs', { story, step: 'video' }, nextDevice())).status).toBe(400);
    expect((await post('/runs', { story, file: '../secret' }, nextDevice())).status).toBe(400);
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ name: `角色${i}` }));
    expect((await post('/runs', { story, characters: tooMany }, nextDevice())).status).toBe(400);
    expect((await fetch(`${baseUrl}/runs/missing`)).status).toBe(404);
    expect((await post('/runs/missing/stream', {})).status).toBe(404);
  });

  it('客户端断开后 run 记为取消', async () => {
    let signal: AbortSignal | undefined;
    llm.streamStoryboard.mockImplementation(async function* (_input, abortSignal: AbortSignal) {
      signal = abortSignal;
      yield '{"scene":"雨夜';
      await new Promise((resolve) => abortSignal.addEventListener('abort', resolve));
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    const device = nextDevice();
    const created = (await (await post('/runs', { story }, device)).json()) as { id: string };
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/runs/${created.id}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': device },
      body: '{}',
      signal: controller.signal,
    });
    await response.body!.getReader().read();
    controller.abort();
    for (let i = 0; i < 50 && !signal?.aborted; i++) await new Promise((r) => setTimeout(r, 10));
    expect(signal?.aborted).toBe(true);

    let status = '';
    for (let i = 0; i < 50 && status !== 'failed'; i++) {
      const view = (await (await fetch(`${baseUrl}/runs/${created.id}`, { headers: { 'x-device-id': nextDevice() } })).json()) as {
        status: string;
        errorCode: string;
      };
      status = view.status;
      if (status === 'failed') expect(view.errorCode).toBe('cancelled');
      else await new Promise((r) => setTimeout(r, 10));
    }
    expect(status).toBe('failed');
  });
});
