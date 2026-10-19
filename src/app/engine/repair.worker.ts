/// <reference lib="webworker" />

import { Analyzer } from './analyze';
import type { WorkerRequest, WorkerResponse } from './engine.types';

const analyzer = new Analyzer();

function post(message: WorkerResponse): void {
  postMessage(message);
}

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === 'analyze') {
      const response = analyzer.analyze(data.request, 'worker', (fraction) =>
        post({ type: 'progress', id: data.id, fraction }),
      );
      post({ type: 'analyzed', id: data.id, response });
    } else {
      post({ type: 'formatted', id: data.id, output: analyzer.format(data.format) });
    }
  } catch (err) {
    post({ type: 'error', id: data.id, message: err instanceof Error ? err.message : String(err) });
  }
});
