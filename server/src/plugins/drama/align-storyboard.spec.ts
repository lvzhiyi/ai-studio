import { alignStoryboard } from './align-storyboard';

const title = '雨夜';

function align(text: string, characters: Array<{ name: string; appearance?: string; outfit?: string; personality?: string }> = []) {
  return alignStoryboard({ title, text, characters });
}

describe('alignStoryboard', () => {
  it('把 JSON Lines 收成引擎分镜表，丢掉景别和道具，未知运镜落成固定', () => {
    const line = JSON.stringify({
      shotSize: '全景',
      scene: '雨夜的老街',
      dialogue: '是你吗',
      reason: '交代环境',
      characters: ['林夏'],
      cameraMove: '缓推',
      durationSec: 3.5,
      props: [{ name: '伞', owner: '林夏' }],
    });
    const result = align(`${line},\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.storyboard).toEqual({
      title,
      defaults: { voice: 'Vivian' },
      characters: { c1: { name: '林夏', look: '角色：林夏' } },
      shots: [
        {
          id: 1,
          image: '雨夜的老街',
          characters: ['c1'],
          line: '是你吗',
          duration: 3.5,
          motion: '运镜：固定',
        },
      ],
    });
    expect(JSON.stringify(result.storyboard)).not.toContain('props');
    expect(JSON.stringify(result.storyboard)).not.toContain('shotSize');
  });

  it('角色卡顺序优先，外貌拼进 look，缺时长默认 3 秒', () => {
    const text = [
      JSON.stringify({ scene: '陈默停下', characters: ['陈默', '林夏'], cameraMove: '拉' }),
      '',
      JSON.stringify({ scene: '  林夏回头  ', dialogue: '', characters: ['林夏'] }),
    ].join('\n');
    const result = align(text, [
      { name: '林夏', appearance: '齐肩短发', outfit: '米色风衣', personality: '慢热' },
      { name: ' 陈默 ' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.storyboard.characters).toEqual({
      c1: { name: '林夏', look: '齐肩短发，米色风衣，慢热' },
      c2: { name: '陈默', look: '角色：陈默' },
    });
    expect(result.storyboard.shots[0]).toMatchObject({
      characters: ['c2', 'c1'],
      duration: 3,
      motion: '运镜：拉',
      line: '',
    });
    expect(result.storyboard.shots[1].image).toBe('林夏回头');
  });

  it('去掉围栏；中文花括号不当成角色占位符', () => {
    const text = '```json\n{"scene":"看见{林夏}"}\n```';
    const result = align(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.storyboard.shots[0].image).toBe('看见{林夏}');
  });

  it('空输出、坏行、空画面、未定义占位符、角色字段不是数组都整份失败', () => {
    expect(align('')).toEqual({ ok: false, code: 'invalid_storyboard' });
    expect(align('{"scene":"好"}\n不是json')).toEqual({ ok: false, code: 'invalid_storyboard' });
    expect(align('{"scene":"  "}')).toEqual({ ok: false, code: 'invalid_storyboard' });
    expect(align('{"scene":"镜头 {missing}"}')).toEqual({ ok: false, code: 'invalid_storyboard' });
    expect(align('{"scene":"好","characters":"林夏"}')).toEqual({ ok: false, code: 'invalid_storyboard' });
    expect(align('{"scene":"好","characters":[1]}')).toEqual({ ok: false, code: 'invalid_storyboard' });
    expect(align('[1,2]')).toEqual({ ok: false, code: 'invalid_storyboard' });
    expect(align('{"scene":"好","durationSec":0}')).toMatchObject({ ok: true });
  });

  it('时长越界时回到默认 3 秒', () => {
    const result = align('{"scene":"好","durationSec":11}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.storyboard.shots[0].duration).toBe(3);
  });
});
