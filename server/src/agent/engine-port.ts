/**
 * 内核看引擎的唯一端口。
 *
 * 这里只有「保存一份已经对齐的分镜表」和「按白名单提交一个步骤」。
 * 不出现 ComfyUI、项目目录、用户或 run：引擎适配器的入参就是引擎自己的分镜文件。
 */

export const ENGINE_STEPS = ['images', 'audio', 'cast', 'qa'] as const;
export type EngineStep = (typeof ENGINE_STEPS)[number];

/** 与 engine `storyboard.load` 对齐的分镜表。字段多出来引擎会照单保存，缺 image / look 会被拒。 */
export interface EngineCharacter {
  name: string;
  look: string;
}

export interface EngineShot {
  id: number;
  image: string;
  characters: string[];
  line: string;
  duration: number;
  motion: string;
}

export interface EngineStoryboard {
  title: string;
  defaults: { voice: string };
  characters: Record<string, EngineCharacter>;
  shots: EngineShot[];
}

export interface EngineHandoff {
  /** 引擎侧文件名，不是 run id。 */
  file: string;
  title: string;
  storyboard: EngineStoryboard;
  /** 缺省只保存。给出时才提交步骤，避免一次 run 默认开出图。 */
  step?: EngineStep;
}

export interface EngineJobRef {
  id: string;
  status: string;
  /** 本切片的步骤名。引擎内部把 images 记成 kind=run，这里不把队列语义漏出去。 */
  step: EngineStep;
}

export interface EngineHandoffResult {
  file: string;
  shotCount: number;
  job: EngineJobRef | null;
}

export class EngineError extends Error {
  constructor(readonly code: 'engine_unavailable' | 'engine_rejected') {
    super(code);
    this.name = 'EngineError';
  }
}

export const ENGINE_ADAPTER = Symbol('ENGINE_ADAPTER');

export interface EngineAdapter {
  handoff(input: EngineHandoff, signal: AbortSignal): Promise<EngineHandoffResult>;
}

const FILE_NAME = /^(?!.*\.\.)(?!\.)[\p{L}\p{N}_\-.]+$/u;

/**
 * 收成引擎 `safe_name` 能接受的 `*.json`。
 * 拒绝路径穿越；不接受空串。调用方传 run id 进来也会被当成普通文件名，适配器不会另加 run 字段。
 */
export function storyboardFileName(file: string): string | null {
  const trimmed = file.trim();
  if (!FILE_NAME.test(trimmed)) return null;
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
}
