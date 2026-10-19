import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  TARGETS,
  generateFromShape,
  highlightCode,
  type HighlightLanguage,
  type Indent,
  type Shape,
  type TargetLanguage,
} from '../../../core';
import { copyText, downloadText, formatBytes } from '../../shared/browser';
import { ToastService } from '../../services/toast.service';
import { Icon } from '../icon/icon';

export type OutputTab = 'json' | TargetLanguage;

/** Only this much text is rendered (with highlighting); copy/download always use everything. */
const PREVIEW_LIMIT = 200_000;

const LANGUAGE: Record<OutputTab, HighlightLanguage> = {
  json: 'json',
  typescript: 'typescript',
  csharp: 'csharp',
  dart: 'dart',
  'json-schema': 'json',
};

@Component({
  selector: 'app-output-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './output-panel.html',
  styleUrl: './output-panel.scss',
})
export class OutputPanel {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly toast = inject(ToastService);

  readonly output = input('');
  readonly shape = input<Shape | null>(null);
  readonly busy = input(false);

  readonly tab = model<OutputTab>('json');
  readonly indent = model<Indent>(2);
  readonly sortKeys = model(false);
  readonly rootName = model('Root');
  readonly namespace = model('JsonSurgeon.Models');

  protected readonly tabs: readonly { id: OutputTab; label: string }[] = [
    { id: 'json', label: 'Repaired JSON' },
    ...TARGETS.map((t) => ({ id: t.id, label: t.label })),
  ];

  protected readonly indentOptions: readonly { value: Indent; label: string }[] = [
    { value: 2, label: '2 spaces' },
    { value: 4, label: '4 spaces' },
    { value: 'tab', label: 'Tabs' },
    { value: 'minify', label: 'Minify' },
  ];

  protected readonly text = computed(() => {
    const tab = this.tab();
    if (tab === 'json') return this.output();
    const shape = this.shape();
    if (!shape) return '';
    return generateFromShape(shape, tab, { rootName: this.rootName(), namespace: this.namespace() });
  });

  protected readonly truncated = computed(() => this.text().length > PREVIEW_LIMIT);

  protected readonly html = computed<SafeHtml>(() => {
    const text = this.text();
    const preview = text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) : text;
    // Safe: highlightCode HTML-escapes all text and only adds <span class="tok-*"> wrappers.
    return this.sanitizer.bypassSecurityTrustHtml(highlightCode(preview, LANGUAGE[this.tab()]));
  });

  protected readonly size = computed(() => formatBytes(new Blob([this.text()]).size));

  protected readonly fileName = computed(() => {
    const tab = this.tab();
    const root = this.rootName().trim() || 'Root';
    switch (tab) {
      case 'json':
        return 'repaired.json';
      case 'typescript':
        return `${kebab(root)}.ts`;
      case 'csharp':
        return `${root.replace(/[^\w]/g, '') || 'Root'}.cs`;
      case 'dart':
        return `${kebab(root).replace(/-/g, '_')}.dart`;
      case 'json-schema':
        return `${kebab(root)}.schema.json`;
    }
  });

  protected onIndentChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    this.indent.set(raw === 'tab' || raw === 'minify' ? raw : (Number(raw) as 2 | 4));
  }

  protected async copy(): Promise<void> {
    const ok = await copyText(this.text());
    this.toast.show(ok ? 'Copied to clipboard' : 'Could not access the clipboard', ok ? 'success' : 'error');
  }

  protected download(): void {
    const mime = this.tab() === 'json' || this.tab() === 'json-schema' ? 'application/json' : 'text/plain';
    downloadText(this.fileName(), this.text(), mime);
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}

function kebab(name: string): string {
  return (
    name
      .replace(/([a-z\d])([A-Z])/g, '$1-$2')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'root'
  );
}
