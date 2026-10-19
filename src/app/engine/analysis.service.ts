import { Injectable, OnDestroy, signal } from '@angular/core';
import type { FormatOptions } from '../../core';
import { Analyzer } from './analyze';
import type { AnalyzeRequest, AnalyzeResponse, WorkerRequest, WorkerResponse } from './engine.types';

/** Inputs larger than this are parsed in a Web Worker so the UI never freezes. */
export const WORKER_THRESHOLD = 500 * 1024;

interface Pending {
  resolve: (value: AnalyzeResponse | string) => void;
  reject: (reason: Error) => void;
}

/**
 * Runs the repair pipeline either inline (small inputs) or in a Web Worker
 * (large inputs). A newer request supersedes older ones: their promises
 * resolve to `null` and their results are dropped.
 */
@Injectable({ providedIn: 'root' })
export class AnalysisService implements OnDestroy {
  /** 0..1 progress of the current worker job, or `null` when idle. */
  readonly progress = signal<number | null>(null);

  private readonly inline = new Analyzer();
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private latestId = 0;
  private lastBackend: AnalyzeResponse['backend'] = 'main';

  async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse | null> {
    const id = this.nextId++;
    this.latestId = id;
    const useWorker = request.input.length > WORKER_THRESHOLD && typeof Worker !== 'undefined';

    if (!useWorker) {
      this.cancelWorkerJobs();
      this.progress.set(null);
      // Yield once so rapid keystrokes coalesce and the UI can paint.
      await Promise.resolve();
      if (id !== this.latestId) return null;
      this.lastBackend = 'main';
      return this.inline.analyze(request, 'main');
    }

    this.cancelWorkerJobs();
    this.progress.set(0);
    try {
      const response = (await this.send({ type: 'analyze', id, request })) as AnalyzeResponse;
      if (id !== this.latestId) return null;
      this.lastBackend = 'worker';
      return response;
    } catch (err) {
      if (id !== this.latestId) return null;
      throw err;
    } finally {
      if (id === this.latestId) this.progress.set(null);
    }
  }

  /** Re-formats the last analyzed document without parsing it again. */
  async format(format: FormatOptions): Promise<string> {
    if (this.lastBackend === 'main' || !this.worker) return this.inline.format(format);
    const id = this.nextId++;
    return (await this.send({ type: 'format', id, format })) as string;
  }

  ngOnDestroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./repair.worker', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', ({ data }: MessageEvent<WorkerResponse>) => this.onMessage(data));
      this.worker.addEventListener('error', (event) => {
        const error = new Error(event.message || 'The background worker crashed.');
        for (const p of this.pending.values()) p.reject(error);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      });
    }
    return this.worker;
  }

  private send(message: WorkerRequest): Promise<AnalyzeResponse | string> {
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject });
      worker.postMessage(message);
    });
  }

  private onMessage(message: WorkerResponse): void {
    if (message.type === 'progress') {
      if (message.id === this.latestId) this.progress.set(message.fraction);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.type === 'analyzed') pending.resolve(message.response);
    else if (message.type === 'formatted') pending.resolve(message.output);
    else pending.reject(new Error(message.message));
  }

  /** A stale parse of a huge file may take a while: kill it rather than wait. */
  private cancelWorkerJobs(): void {
    const busy = [...this.pending.keys()].some((id) => id !== this.latestId);
    if (busy && this.worker) {
      this.worker.terminate();
      this.worker = null;
      for (const p of this.pending.values()) p.reject(new Error('cancelled'));
      this.pending.clear();
    }
  }
}
