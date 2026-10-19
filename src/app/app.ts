import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { EXAMPLES, decodeShareHash, encodeShareHash, type FormatOptions, type Indent } from '../core';
import { Icon } from './components/icon/icon';
import { InputEditor, type LoadedFile } from './components/input-editor/input-editor';
import { OutputPanel, type OutputTab } from './components/output-panel/output-panel';
import { RepairList } from './components/repair-list/repair-list';
import { AnalysisService } from './engine/analysis.service';
import type { AnalyzeResponse } from './engine/engine.types';
import { StorageService } from './services/storage.service';
import { ThemeService } from './services/theme.service';
import { ToastService } from './services/toast.service';
import { copyText, formatBytes } from './shared/browser';

interface Settings {
  indent: Indent;
  sortKeys: boolean;
  rootName: string;
  namespace: string;
  tab: OutputTab;
  multipleValues: 'first' | 'array';
}

const DEFAULT_SETTINGS: Settings = {
  indent: 2,
  sortKeys: false,
  rootName: 'Order',
  namespace: 'JsonSurgeon.Models',
  tab: 'json',
  multipleValues: 'first',
};

/** Share links above this size still work in browsers, but chat apps may truncate them. */
const LONG_LINK = 32_000;

/** Browsers normalize textarea line breaks to \n; do the same so offsets always match. */
const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, '\n');

@Component({
  selector: 'app-root',
  imports: [Icon, InputEditor, RepairList, OutputPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly analysis = inject(AnalysisService);
  private readonly storage = inject(StorageService);
  protected readonly theme = inject(ThemeService);
  protected readonly toasts = inject(ToastService);

  protected readonly examples = EXAMPLES;

  protected readonly input = signal('');
  protected readonly fileName = signal<string | null>(null);
  protected readonly result = signal<AnalyzeResponse | null>(null);
  protected readonly output = signal('');
  protected readonly busy = signal(false);
  protected readonly activeRepair = signal<number | null>(null);
  protected readonly progress = this.analysis.progress;

  private readonly saved = this.storage.getJson<Settings>('settings', DEFAULT_SETTINGS);
  protected readonly indent = signal<Indent>(this.saved.indent);
  protected readonly sortKeys = signal(this.saved.sortKeys);
  protected readonly rootName = signal(this.saved.rootName);
  protected readonly namespace = signal(this.saved.namespace);
  protected readonly tab = signal<OutputTab>(this.saved.tab);
  protected readonly multipleValues = signal<'first' | 'array'>(this.saved.multipleValues);

  private readonly formatOptions = computed<FormatOptions>(() => ({ indent: this.indent(), sortKeys: this.sortKeys() }));
  private readonly editor = viewChild.required(InputEditor);

  private ready = false;
  private analyzedFormat: FormatOptions | null = null;
  /** Skip the debounce for programmatic loads (examples, files, share links). */
  private immediate = true;

  protected readonly status = computed(() => {
    const r = this.result();
    if (!r) return '';
    const where = r.backend === 'worker' ? 'in a Web Worker' : 'on the main thread';
    return `Processed ${formatBytes(new Blob([this.input()]).size)} in ${r.durationMs} ms ${where}`;
  });

  constructor() {
    void this.restore();

    // Re-run the repair whenever the input or the multi-value mode changes.
    effect((onCleanup) => {
      const input = this.input();
      const multipleValues = this.multipleValues();
      if (!this.ready) return;
      const delay = this.immediate ? 0 : input.length > 200_000 ? 450 : 180;
      this.immediate = false;
      const timer = setTimeout(() => void this.run(input, multipleValues), delay);
      onCleanup(() => clearTimeout(timer));
    });

    // Formatting changes only need a re-serialization, not a re-parse.
    effect(() => {
      const format = this.formatOptions();
      if (!this.ready || !untracked(this.result) || sameFormat(format, this.analyzedFormat)) return;
      this.analysis
        .format(format)
        .then((out) => {
          this.analyzedFormat = format;
          this.output.set(out);
        })
        .catch(() => undefined);
    });

    // Persist settings and (debounced) input.
    effect(() => {
      const settings: Settings = {
        indent: this.indent(),
        sortKeys: this.sortKeys(),
        rootName: this.rootName(),
        namespace: this.namespace(),
        tab: this.tab(),
        multipleValues: this.multipleValues(),
      };
      this.storage.setJson('settings', settings);
    });
    effect((onCleanup) => {
      const input = this.input();
      if (!this.ready) return;
      const timer = setTimeout(() => this.storage.saveInput(input), 600);
      onCleanup(() => clearTimeout(timer));
    });

    const onHash = () => void this.loadFromHash();
    window.addEventListener('hashchange', onHash);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('hashchange', onHash));
  }

  protected onInputChange(value: string): void {
    this.activeRepair.set(null);
    this.input.set(value);
  }

  protected onFileLoaded(file: LoadedFile): void {
    this.load(file.text);
    this.fileName.set(file.name);
    this.toasts.show(`Loaded ${file.name} (${formatBytes(file.size)})`, 'info');
  }

  protected onExampleSelected(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const example = EXAMPLES.find((e) => e.id === select.value);
    select.value = '';
    if (!example) return;
    this.load(example.input);
    this.rootName.set(example.rootName);
  }

  protected onSelectRepair(index: number): void {
    const repair = this.result()?.repairs[index];
    if (!repair) return;
    if (this.activeRepair() === index) {
      // Clicking the same fix again restarts the highlight animation.
      this.activeRepair.set(null);
      requestAnimationFrame(() => this.activeRepair.set(index));
    } else {
      this.activeRepair.set(index);
    }
    this.editor().reveal(repair);
  }

  protected toggleMultipleValues(): void {
    this.multipleValues.update((m) => (m === 'first' ? 'array' : 'first'));
  }

  protected async share(): Promise<void> {
    const input = this.input();
    if (!input.trim()) {
      this.toasts.show('Nothing to share yet', 'info');
      return;
    }
    try {
      const url = location.href.split('#')[0] + (await encodeShareHash(input));
      const ok = await copyText(url);
      const note = url.length > LONG_LINK ? ` (${formatBytes(url.length)} — some apps may cut long links)` : '';
      this.toasts.show(
        ok ? `Share link copied. The data is inside the link, never on a server${note}.` : 'Could not access the clipboard',
        ok ? 'success' : 'error',
        4500,
      );
    } catch {
      this.toasts.show('This browser cannot compress share links', 'error');
    }
  }

  private load(text: string): void {
    this.immediate = true;
    this.fileName.set(null);
    this.activeRepair.set(null);
    this.input.set(normalizeNewlines(text));
  }

  private async run(input: string, multipleValues: 'first' | 'array'): Promise<void> {
    const format = untracked(this.formatOptions);
    this.busy.set(true);
    try {
      const response = await this.analysis.analyze({ input, multipleValues, format });
      if (!response) return; // superseded by a newer request
      this.analyzedFormat = format;
      this.result.set(response);
      this.output.set(response.output);
      if (!sameFormat(format, untracked(this.formatOptions))) {
        this.output.set(await this.analysis.format(untracked(this.formatOptions)));
        this.analyzedFormat = untracked(this.formatOptions);
      }
      this.busy.set(false);
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') return;
      this.busy.set(false);
      this.toasts.show(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  private async restore(): Promise<void> {
    const fromHash = await this.loadFromHash();
    if (!fromHash) {
      const stored = this.storage.get('input');
      this.input.set(normalizeNewlines(stored ?? EXAMPLES[0].input));
      if (stored === null) this.rootName.set(EXAMPLES[0].rootName);
    }
    this.ready = true;
    this.immediate = false;
    // The analysis effect ignored changes made before `ready`, so run the first pass directly.
    void this.run(this.input(), this.multipleValues());
  }

  private async loadFromHash(): Promise<boolean> {
    const shared = await decodeShareHash(location.hash);
    if (shared === null) return false;
    this.load(shared);
    // Drop the hash so later reloads use the latest edits rather than the old link.
    history.replaceState(null, '', location.pathname + location.search);
    if (this.ready) this.toasts.show('Loaded shared input', 'info');
    return true;
  }
}

function sameFormat(a: FormatOptions, b: FormatOptions | null): boolean {
  return !!b && a.indent === b.indent && !!a.sortKeys === !!b.sortKeys;
}
