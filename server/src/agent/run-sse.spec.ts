import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import { EngineError } from './engine-port';
import { pipeRun } from './run-sse';
import { ToolLoopError } from './tool-loop';
import { UpstreamError } from '../llm/llm.service';

function fakeResponse() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const listeners = new Map<string, Array<() => void>>();
  const res = {
    writableEnded: false,
    writableFinished: false,
    status(code: number) {
      headers.status = String(code);
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    flushHeaders() {},
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      this.writableEnded = true;
      this.writableFinished = true;
    },
    on(event: string, cb: () => void) {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
    },
    emit(event: string) {
      for (const cb of listeners.get(event) ?? []) cb();
    },
  };
  return { res: res as unknown as Response & { emit(event: string): void }, chunks, headers };
}

describe('pipeRun', () => {
  const logger = new Logger('test');

  beforeEach(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  it('写出 SSE 头、心跳和结束帧', async () => {
    const { res, chunks, headers } = fakeResponse();
    await pipeRun(res, logger, 5, async (send) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      send('result', { shotCount: 1 });
      send('done', { status: 'succeeded' });
    });
    expect(headers.status).toBe('200');
    expect(headers['content-type']).toContain('text/event-stream');
    expect(headers['x-accel-buffering']).toBe('no');
    expect(chunks.some((chunk) => chunk.startsWith(': ping'))).toBe(true);
    expect(chunks.join('')).toContain('event: result\ndata: {"shotCount":1}');
    expect(chunks.join('')).toContain('event: done\ndata: {"status":"succeeded"}');
  });

  it('失败只写错误码，客户端断开后不再写 error', async () => {
    const failed = fakeResponse();
    await pipeRun(failed.res, logger, 60_000, async () => {
      throw new EngineError('engine_rejected');
    });
    expect(failed.chunks.join('')).toContain('event: error\ndata: {"code":"engine_rejected"}');
    expect(logger.warn).toHaveBeenCalledWith('run 失败：engine_rejected');

    const upstream = fakeResponse();
    await pipeRun(upstream.res, logger, 60_000, async () => {
      throw new UpstreamError(502);
    });
    expect(upstream.chunks.join('')).toContain('{"code":"upstream_error"}');

    const internal = fakeResponse();
    await pipeRun(internal.res, logger, 60_000, async () => {
      throw new Error('带故事正文的意外错误');
    });
    expect(internal.chunks.join('')).toContain('{"code":"internal_error"}');
    expect(internal.chunks.join('')).not.toContain('带故事正文');

    const closed = fakeResponse();
    const pending = pipeRun(closed.res, logger, 60_000, async (send, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      send('status', { status: 'running' });
      throw new ToolLoopError('cancelled');
    });
    closed.res.emit('close');
    await pending;
    expect(closed.chunks.join('')).not.toContain('event: error');
    expect(closed.chunks.join('')).not.toContain('event: status');
  });
});
