import { EngineAdapter, EngineError, EngineHandoff, EngineHandoffResult, storyboardFileName } from '../agent/engine-port';

/** 测试用引擎。不发 HTTP，文件名规则与真实适配器相同，避免用例漂移。 */
export class MockEngineAdapter implements EngineAdapter {
  readonly calls: EngineHandoff[] = [];
  error: EngineError | Error | null = null;

  async handoff(input: EngineHandoff, signal: AbortSignal): Promise<EngineHandoffResult> {
    if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    this.calls.push(input);
    if (this.error) throw this.error;
    const file = storyboardFileName(input.file);
    if (!file) throw new EngineError('engine_rejected');
    return {
      file,
      shotCount: input.storyboard.shots.length,
      job: input.step ? { id: 'job-mock', status: 'queued', step: input.step } : null,
    };
  }
}
