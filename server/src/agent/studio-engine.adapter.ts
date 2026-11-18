import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ENGINE_STEPS,
  EngineAdapter,
  EngineError,
  EngineHandoff,
  EngineHandoffResult,
  EngineJobRef,
  EngineStep,
  storyboardFileName,
} from './engine-port';

interface HttpResult {
  ok: boolean;
  status: number;
  /** 仅用于判断「同名已存在」和取出任务 id。调用方不得写入日志。 */
  text: string;
}

/**
 * studio-engine 控制台的 HTTP 适配器（默认 `http://127.0.0.1:8780`）。
 *
 * 跟 MCP 一样走现成的 `/api/storyboards` 和 `/api/jobs`，不新开引擎协议。
 * 探活用分镜列表而不是 `/api/checks`：后者会去探 ComfyUI / LM Studio，要几秒，不适合每次 handoff。
 * 请求体是分镜表本身，日志只留方法、路径和状态码。
 */
@Injectable()
export class StudioEngineAdapter implements EngineAdapter {
  private readonly logger = new Logger(StudioEngineAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async handoff(input: EngineHandoff, signal: AbortSignal): Promise<EngineHandoffResult> {
    const file = storyboardFileName(input.file);
    if (!file || (input.step !== undefined && !ENGINE_STEPS.includes(input.step))) {
      throw new EngineError('engine_rejected');
    }

    const probe = await this.send('GET', '/api/storyboards', signal);
    if (!probe.ok) this.fail('探活', probe);

    const created = await this.send('POST', '/api/storyboards', signal, { file, title: input.title });
    // 引擎没有「有则覆盖」的创建接口：同名 400 时直接 PUT。其它 4xx 不再继续，避免把占位分镜表留下来。
    if (!created.ok && !(created.status === 400 && created.text.includes('已经有同名'))) {
      this.fail('创建分镜表', created);
    }

    const saved = await this.send('PUT', `/api/storyboards/${encodeURIComponent(file)}`, signal, {
      data: input.storyboard,
    });
    if (!saved.ok) this.fail('保存分镜表', saved);

    const job = input.step ? await this.submit(file, input.step, signal) : null;
    return { file, shotCount: input.storyboard.shots.length, job };
  }

  private async submit(file: string, step: EngineStep, signal: AbortSignal): Promise<EngineJobRef> {
    const posted = await this.send('POST', '/api/jobs', signal, jobBody(file, step));
    if (!posted.ok) this.fail('提交步骤', posted);
    const parsed = parseJob(posted.text, step);
    if (!parsed) throw new EngineError('engine_rejected');
    return parsed;
  }

  private fail(action: string, result: HttpResult): never {
    if (result.status > 0) this.logger.warn(`引擎${action}失败：${result.status}`);
    throw new EngineError(result.status === 0 ? 'engine_unavailable' : 'engine_rejected');
  }

  private get baseUrl(): string {
    return (this.config.get<string>('ENGINE_BASE_URL') ?? 'http://127.0.0.1:8780').replace(/\/+$/, '');
  }

  /** 测试通过 ConfigService 把 ENGINE_TIMEOUT_MS 收短。不放进 .env.example，避免多一个要记的运维项。 */
  private get timeoutMs(): number {
    const raw = Number(this.config.get<string>('ENGINE_TIMEOUT_MS') ?? 10_000);
    return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
  }

  private async send(method: string, path: string, signal: AbortSignal, body?: unknown): Promise<HttpResult> {
    // 自己计时并在结束后清掉，避免成功请求也把超时句柄留到 10 秒后。
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const combined = AbortSignal.any([signal, timeout.signal]);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: combined,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // 读完正文才能归还连接。正文可能含分镜，只留在这个返回值里，不进日志。
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    } catch (error) {
      if (signal.aborted) throw error;
      this.logger.warn(`引擎请求失败：${method} ${path} ${timeout.signal.aborted ? 'timeout' : 'network'}`);
      return { ok: false, status: 0, text: '' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 与引擎 `build_job` 的白名单对齐，不接受调用方拼的任意参数。 */
function jobBody(file: string, step: EngineStep): { kind: string; file: string; options: Record<string, unknown> } {
  if (step === 'cast' || step === 'qa') return { kind: step, file, options: {} };
  return { kind: 'run', file, options: { only: step } };
}

function parseJob(text: string, step: EngineStep): EngineJobRef | null {
  try {
    const json = JSON.parse(text) as { id?: unknown; status?: unknown };
    if (typeof json.id !== 'string' || json.id === '' || typeof json.status !== 'string' || json.status === '') {
      return null;
    }
    return { id: json.id, status: json.status, step };
  } catch {
    return null;
  }
}
