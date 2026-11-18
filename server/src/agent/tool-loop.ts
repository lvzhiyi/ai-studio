/**
 * 一轮工具循环：按调用方给的计划依次执行，失败即停。
 *
 * 本切片不做模型决定下一步。计划由 drama 插件写死（拆分镜 → 交给引擎），
 * 上限只是防止以后把计划配成开放式多轮时，内核还在无界地跑。
 */

export interface ToolTrace {
  name: string;
  ok: boolean;
  summary: string;
}

export interface ToolEvent {
  name: string;
  phase: 'start' | 'end';
  ok?: boolean;
  summary?: string;
}

export interface ToolContext<TBag> {
  signal: AbortSignal;
  bag: TBag;
  emit(event: ToolEvent): void;
}

export interface Tool<TBag> {
  readonly name: string;
  execute(ctx: ToolContext<TBag>): Promise<{ ok: boolean; summary: string; errorCode?: string }>;
}

export interface LoopResult {
  ok: boolean;
  errorCode?: string;
  tools: ToolTrace[];
}

export class ToolLoopError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ToolLoopError';
  }
}

/** 一轮里最多调用几次工具。当前计划是 2，留一点余量给以后插校验，但不开放多轮。 */
export const MAX_TOOL_CALLS = 4;

const SUMMARY_LIMIT = 80;

export async function runToolLoop<TBag>(tools: readonly Tool<TBag>[], ctx: ToolContext<TBag>): Promise<LoopResult> {
  if (tools.length === 0 || tools.length > MAX_TOOL_CALLS) {
    return { ok: false, errorCode: 'internal_error', tools: [] };
  }

  const trace: ToolTrace[] = [];
  for (const tool of tools) {
    if (ctx.signal.aborted) throw new ToolLoopError('cancelled');
    ctx.emit({ name: tool.name, phase: 'start' });
    let observation: { ok: boolean; summary: string; errorCode?: string };
    try {
      observation = await tool.execute(ctx);
    } catch (error) {
      if (ctx.signal.aborted) throw new ToolLoopError('cancelled');
      throw error;
    }
    const summary = observation.summary.slice(0, SUMMARY_LIMIT);
    trace.push({ name: tool.name, ok: observation.ok, summary });
    ctx.emit({ name: tool.name, phase: 'end', ok: observation.ok, summary });
    if (!observation.ok) {
      return { ok: false, errorCode: observation.errorCode ?? 'internal_error', tools: trace };
    }
  }
  return { ok: true, tools: trace };
}
