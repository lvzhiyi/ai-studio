import { EngineAdapter, EngineError, EngineHandoffResult, EngineStoryboard } from '../../agent/engine-port';
import { RunInput } from '../../agent/run-store';
import { Tool } from '../../agent/tool-loop';
import { LlmService, UpstreamError } from '../../llm/llm.service';
import { alignStoryboard } from './align-storyboard';

/** 一轮计划的交接袋。input 由服务在开跑前放进来，工具不闭包捕获某一次请求。 */
export interface DramaBag {
  input: RunInput;
  storyboard?: EngineStoryboard;
  handoff?: EngineHandoffResult;
}

/** 模型输出的上限。正常分镜远小于此；超过就当无效，避免无界拼接。 */
const MAX_DRAFT_CHARS = 200_000;

/**
 * 本切片的一轮计划：先用现有分镜网关起草，再交给引擎适配器。
 * 工具本身不决定要不要再跑一轮，也不接收 run id。
 */
export function createDramaTools(llm: LlmService, engine: EngineAdapter): Array<Tool<DramaBag>> {
  return [draftTool(llm), handoffTool(engine)];
}

export function bagWithInput(input: RunInput): DramaBag {
  return { input };
}

function draftTool(llm: LlmService): Tool<DramaBag> {
  return {
    name: 'draft_storyboard',
    async execute(ctx) {
      const input = ctx.bag.input;
      let text = '';
      try {
        for await (const chunk of llm.streamStoryboard(
          { story: input.story, characters: input.characters },
          ctx.signal,
        )) {
          text += chunk;
          if (text.length > MAX_DRAFT_CHARS) {
            return { ok: false, summary: '分镜输出过长', errorCode: 'invalid_storyboard' };
          }
        }
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        if (error instanceof UpstreamError) return { ok: false, summary: '分镜生成失败', errorCode: 'upstream_error' };
        return { ok: false, summary: '分镜生成失败', errorCode: 'internal_error' };
      }

      const aligned = alignStoryboard({ title: input.title, text, characters: input.characters });
      if (!aligned.ok) return { ok: false, summary: '分镜无法对齐引擎格式', errorCode: 'invalid_storyboard' };
      ctx.bag.storyboard = aligned.storyboard;
      return { ok: true, summary: `解析出 ${aligned.storyboard.shots.length} 个镜头` };
    },
  };
}

function handoffTool(engine: EngineAdapter): Tool<DramaBag> {
  return {
    name: 'engine_handoff',
    async execute(ctx) {
      const storyboard = ctx.bag.storyboard;
      if (!storyboard) return { ok: false, summary: '没有可交给引擎的分镜', errorCode: 'internal_error' };
      const input = ctx.bag.input;
      try {
        const result = await engine.handoff(
          { file: input.file, title: input.title, storyboard, step: input.step },
          ctx.signal,
        );
        ctx.bag.handoff = result;
        const step = result.job ? `，已提交 ${result.job.step} 步骤` : '，仅保存';
        return { ok: true, summary: `已交给引擎，${result.shotCount} 个镜头${step}` };
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        if (error instanceof EngineError) return { ok: false, summary: '引擎未接受分镜', errorCode: error.code };
        return { ok: false, summary: '引擎未接受分镜', errorCode: 'engine_unavailable' };
      }
    },
  };
}
