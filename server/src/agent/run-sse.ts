import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import { EngineError } from './engine-port';
import { ToolLoopError } from './tool-loop';
import { UpstreamError } from '../llm/llm.service';

/**
 * run 的 SSE。帧格式和分镜接口同一套（event + data JSON），事件换成这次循环的进度和结果：
 * - `status` / `tool`：进度，不含故事正文
 * - `result`：对齐后的分镜表和引擎任务引用
 * - `done` / `error`：结束。error 只有 code
 * 客户端断开时中止本轮循环。
 */
export async function pipeRun(
  res: Response,
  logger: Logger,
  heartbeatMs: number,
  produce: (send: (event: string, data: unknown) => void, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  const send = (event: string, data: unknown): void => {
    if (res.writableEnded || abort.signal.aborted) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !abort.signal.aborted) res.write(': ping\n\n');
  }, heartbeatMs);

  try {
    await produce(send, abort.signal);
  } catch (error) {
    if (!abort.signal.aborted) {
      const code = errorCode(error);
      logger.warn(`run 失败：${code}`);
      send('error', { code });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}

function errorCode(error: unknown): string {
  if (error instanceof ToolLoopError) return error.code;
  if (error instanceof EngineError) return error.code;
  if (error instanceof UpstreamError) return 'upstream_error';
  return 'internal_error';
}
