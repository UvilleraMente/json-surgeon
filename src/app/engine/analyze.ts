import { formatJson, inferShape, repairJson, type FormatOptions, type JsonNode } from '../../core';
import type { AnalyzeRequest, AnalyzeResponse } from './engine.types';

/**
 * Runs the full pipeline (repair → infer → format) and keeps the syntax tree
 * around so the output can be re-formatted without parsing again. The same
 * class is used on the main thread for small inputs and inside the worker.
 */
export class Analyzer {
  private lastValue: JsonNode | null = null;

  analyze(request: AnalyzeRequest, backend: AnalyzeResponse['backend'], onProgress?: (f: number) => void): AnalyzeResponse {
    const started = performance.now();
    const result = repairJson(request.input, { multipleValues: request.multipleValues, onProgress });
    this.lastValue = result.value;
    const shape = result.value ? inferShape(result.value) : null;
    const output = result.value ? formatJson(result.value, request.format) : '';
    return {
      ok: result.ok,
      valid: result.valid,
      summary: result.summary,
      error: result.error,
      repairs: result.repairs,
      shape,
      output,
      durationMs: Math.round(performance.now() - started),
      backend,
    };
  }

  format(format: FormatOptions): string {
    return this.lastValue ? formatJson(this.lastValue, format) : '';
  }
}
