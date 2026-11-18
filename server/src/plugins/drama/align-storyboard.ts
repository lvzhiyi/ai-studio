import { CAMERA_MOVES } from '../../storyboard/storyboard.prompt';
import { EngineStoryboard } from '../../agent/engine-port';

export interface AlignCharacter {
  name: string;
  appearance?: string;
  outfit?: string;
  personality?: string;
}

export interface AlignInput {
  title: string;
  /** 模型输出的 JSON Lines。内容只用于解析，调用方不要把它写进日志。 */
  text: string;
  characters: AlignCharacter[];
}

export type AlignResult = { ok: true; storyboard: EngineStoryboard } | { ok: false; code: 'invalid_storyboard' };

const DEFAULT_DURATION = 3;
const DEFAULT_VOICE = 'Vivian';

interface RawShot {
  scene?: unknown;
  dialogue?: unknown;
  characters?: unknown;
  cameraMove?: unknown;
  durationSec?: unknown;
}

/**
 * 把现有分镜模型的 JSON Lines 收成引擎分镜表。
 *
 * 提示词仍是镜头本字段（景别、运镜、道具）。这里只做结构对齐，不改写画面文案、也不翻译成英文 look：
 * 那一步要动提示词，学习日志里留到有评测基线再做。引擎表没有的字段（景别、道具、reason）直接丢掉。
 */
export function alignStoryboard(input: AlignInput): AlignResult {
  const rows = parseJsonLines(input.text);
  if (!rows) return { ok: false, code: 'invalid_storyboard' };

  const names: string[] = [];
  for (const character of input.characters) pushName(names, character.name);
  for (const row of rows) {
    if (!Array.isArray(row.characters)) continue;
    for (const name of row.characters) {
      if (typeof name === 'string') pushName(names, name);
    }
  }

  const ids = new Map<string, string>();
  names.forEach((name, index) => ids.set(name, `c${index + 1}`));

  const known = new Map(input.characters.map((character) => [character.name.trim(), character]));
  const characters: EngineStoryboard['characters'] = {};
  for (const name of names) {
    const id = ids.get(name)!;
    characters[id] = { name, look: lookOf(known.get(name), name) };
  }

  const shots: EngineStoryboard['shots'] = [];
  for (const row of rows) {
    if (typeof row.scene !== 'string' || row.scene.trim() === '' || row.scene.length > 2000) {
      return { ok: false, code: 'invalid_storyboard' };
    }
    const image = row.scene.trim();
    if (unknownPlaceholder(image, characters)) return { ok: false, code: 'invalid_storyboard' };
    const listed = listCharacters(row.characters, ids);
    if (listed === null) return { ok: false, code: 'invalid_storyboard' };
    shots.push({
      id: shots.length + 1,
      image,
      characters: listed,
      line: typeof row.dialogue === 'string' ? row.dialogue : '',
      duration: durationOf(row.durationSec),
      motion: motionOf(row.cameraMove),
    });
  }

  return {
    ok: true,
    storyboard: {
      title: input.title,
      defaults: { voice: DEFAULT_VOICE },
      characters,
      shots,
    },
  };
}

/** 行尾逗号、空行、整段围栏都是模型常见的脏输出，修完再解析。修不好就整份失败，不把半份交给引擎。 */
function parseJsonLines(text: string): RawShot[] | null {
  let body = text.trim();
  if (body.startsWith('```')) {
    body = body.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  const rows: RawShot[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/,\s*$/, '');
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      rows.push(value as RawShot);
    } catch {
      return null;
    }
  }
  return rows.length > 0 ? rows : null;
}

function pushName(names: string[], name: string): void {
  const trimmed = name.trim();
  if (!trimmed || names.includes(trimmed)) return;
  names.push(trimmed);
}

function lookOf(character: AlignCharacter | undefined, name: string): string {
  const parts = [character?.appearance, character?.outfit, character?.personality]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  // 引擎要求 look 非空。没有角色卡时用名字占位，不在这里编英文外貌。
  return parts.length > 0 ? parts.join('，') : `角色：${name}`;
}

function listCharacters(value: unknown, ids: Map<string, string>): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const listed: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const id = ids.get(item.trim());
    if (!id || listed.includes(id)) continue;
    listed.push(id);
  }
  return listed;
}

function durationOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10) return DEFAULT_DURATION;
  return value;
}

function motionOf(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  const normalized = (CAMERA_MOVES as readonly string[]).includes(text) ? text : '固定';
  return `运镜：${normalized}`;
}

/** 引擎会检查 `{id}` 是否已定义。中文名字匹配不到这个正则，不会误伤画面描述。 */
function unknownPlaceholder(image: string, characters: EngineStoryboard['characters']): boolean {
  const ids = new Set(Object.keys(characters));
  for (const match of image.matchAll(/\{([A-Za-z_][\w-]*)\}/g)) {
    if (!ids.has(match[1])) return true;
  }
  return false;
}
