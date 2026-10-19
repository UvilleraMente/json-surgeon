import type { FormatOptions, Repair, Shape } from '../../core';

export interface AnalyzeRequest {
  readonly input: string;
  readonly multipleValues: 'first' | 'array';
  readonly format: FormatOptions;
}

export interface AnalyzeResponse {
  readonly ok: boolean;
  readonly valid: boolean;
  readonly summary: string;
  readonly error?: string;
  readonly repairs: readonly Repair[];
  /** Inferred shape of the repaired document (small: one entry per distinct key path). */
  readonly shape: Shape | null;
  /** The repaired document, formatted with the requested options. */
  readonly output: string;
  readonly durationMs: number;
  /** Where the work ran — handy for the status bar. */
  readonly backend: 'main' | 'worker';
}

/** Messages sent to the repair worker. */
export type WorkerRequest =
  | { readonly type: 'analyze'; readonly id: number; readonly request: AnalyzeRequest }
  | { readonly type: 'format'; readonly id: number; readonly format: FormatOptions };

/** Messages sent back by the repair worker. */
export type WorkerResponse =
  | { readonly type: 'progress'; readonly id: number; readonly fraction: number }
  | { readonly type: 'analyzed'; readonly id: number; readonly response: AnalyzeResponse }
  | { readonly type: 'formatted'; readonly id: number; readonly output: string }
  | { readonly type: 'error'; readonly id: number; readonly message: string };
