import { MAX_TOOL_CALLS, runToolLoop, Tool, ToolLoopError } from './tool-loop';

interface Bag {
  seen: string[];
}

function tool(name: string, run: Tool<Bag>['execute']): Tool<Bag> {
  return { name, execute: run };
}

describe('runToolLoop', () => {
  const signal = new AbortController().signal;

  it('按顺序跑完一轮，摘要被截断', async () => {
    const bag: Bag = { seen: [] };
    const events: string[] = [];
    const result = await runToolLoop(
      [
        tool('draft', async (ctx) => {
          ctx.bag.seen.push('draft');
          return { ok: true, summary: 'a'.repeat(100) };
        }),
        tool('handoff', async (ctx) => {
          ctx.bag.seen.push('handoff');
          return { ok: true, summary: '已交给引擎' };
        }),
      ],
      { signal, bag, emit: (event) => events.push(`${event.phase}:${event.name}:${event.summary ?? ''}`) },
    );
    expect(bag.seen).toEqual(['draft', 'handoff']);
    expect(result).toEqual({
      ok: true,
      tools: [
        { name: 'draft', ok: true, summary: 'a'.repeat(80) },
        { name: 'handoff', ok: true, summary: '已交给引擎' },
      ],
    });
    expect(events).toEqual(['start:draft:', 'end:draft:' + 'a'.repeat(80), 'start:handoff:', 'end:handoff:已交给引擎']);
  });

  it('第一步失败就停，没有 errorCode 时记 internal_error', async () => {
    const second = jest.fn();
    const result = await runToolLoop(
      [tool('draft', async () => ({ ok: false, summary: '分镜无法对齐引擎格式' })), tool('handoff', second)],
      { signal, bag: { seen: [] }, emit: () => undefined },
    );
    expect(result).toEqual({
      ok: false,
      errorCode: 'internal_error',
      tools: [{ name: 'draft', ok: false, summary: '分镜无法对齐引擎格式' }],
    });
    expect(second).not.toHaveBeenCalled();
  });

  it('空计划和超上限的计划不调用工具', async () => {
    const run = jest.fn();
    const tools = Array.from({ length: MAX_TOOL_CALLS + 1 }, (_, i) => tool(`t${i}`, run));
    expect(await runToolLoop([], { signal, bag: { seen: [] }, emit: () => undefined })).toMatchObject({
      ok: false,
      errorCode: 'internal_error',
    });
    expect(await runToolLoop(tools, { signal, bag: { seen: [] }, emit: () => undefined })).toMatchObject({
      ok: false,
      errorCode: 'internal_error',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('开始前已取消、执行中取消、工具抛错分别处理', async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      runToolLoop([tool('draft', jest.fn())], { signal: aborted.signal, bag: { seen: [] }, emit: () => undefined }),
    ).rejects.toEqual(new ToolLoopError('cancelled'));

    const during = new AbortController();
    await expect(
      runToolLoop(
        [
          tool('draft', async (ctx) => {
            during.abort();
            throw new Error('aborted');
          }),
        ],
        { signal: during.signal, bag: { seen: [] }, emit: () => undefined },
      ),
    ).rejects.toEqual(new ToolLoopError('cancelled'));

    await expect(
      runToolLoop(
        [tool('draft', async () => { throw new Error('boom'); })],
        { signal, bag: { seen: [] }, emit: () => undefined },
      ),
    ).rejects.toThrow('boom');
  });
});
