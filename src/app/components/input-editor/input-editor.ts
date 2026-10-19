import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { markRepairs, type Repair } from '../../../core';
import { formatBytes } from '../../shared/browser';
import { Icon } from '../icon/icon';

/** Above this size the highlight backdrop is skipped to keep typing smooth. */
const MAX_HIGHLIGHT_LENGTH = 300_000;

export interface LoadedFile {
  readonly name: string;
  readonly size: number;
  readonly text: string;
}

/**
 * A plain `<textarea>` with a mirrored backdrop that paints a mark behind every
 * repair location. Both layers share font metrics and scroll position, so the
 * marks line up with the text without a heavyweight code editor.
 */
@Component({
  selector: 'app-input-editor',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './input-editor.html',
  styleUrl: './input-editor.scss',
})
export class InputEditor {
  private readonly sanitizer = inject(DomSanitizer);

  readonly value = input.required<string>();
  readonly repairs = input<readonly Repair[]>([]);
  readonly activeIndex = input<number | null>(null);
  readonly fileName = input<string | null>(null);

  readonly valueChange = output<string>();
  readonly fileLoaded = output<LoadedFile>();

  protected readonly dragging = signal(false);
  private readonly textarea = viewChild.required<ElementRef<HTMLTextAreaElement>>('textarea');
  private readonly backdrop = viewChild.required<ElementRef<HTMLDivElement>>('backdrop');
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly highlightEnabled = computed(() => this.value().length <= MAX_HIGHLIGHT_LENGTH);

  protected readonly markedHtml = computed<SafeHtml>(() => {
    if (!this.highlightEnabled()) return '';
    // Safe: markRepairs HTML-escapes every character of the user's text and only adds <mark> tags.
    return this.sanitizer.bypassSecurityTrustHtml(markRepairs(this.value(), this.repairs(), this.activeIndex()));
  });

  protected readonly stats = computed(() => {
    const v = this.value();
    let lines = v.length ? 1 : 0;
    for (let i = v.indexOf('\n'); i >= 0; i = v.indexOf('\n', i + 1)) lines++;
    return `${formatBytes(new Blob([v]).size)} · ${lines.toLocaleString()} line${lines === 1 ? '' : 's'}`;
  });

  protected onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLTextAreaElement).value);
  }

  protected syncScroll(): void {
    const ta = this.textarea().nativeElement;
    const bd = this.backdrop().nativeElement;
    bd.scrollTop = ta.scrollTop;
    bd.scrollLeft = ta.scrollLeft;
  }

  /** Scrolls the textarea to a repair and selects the affected text. */
  reveal(repair: Repair): void {
    const ta = this.textarea().nativeElement;
    // Select first: the browser scrolls the caret into view, then we override with a nicer position.
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(repair.offset, repair.offset + repair.length);

    const style = getComputedStyle(ta);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const charWidth = measureCharWidth(style.font) || 8;
    const paddingTop = parseFloat(style.paddingTop) || 0;

    const top = (repair.line - 1) * lineHeight + paddingTop;
    ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
    const left = (repair.column - 1) * charWidth;
    ta.scrollLeft = left < ta.clientWidth * 0.6 ? 0 : left - ta.clientWidth / 3;

    this.syncScroll();
  }

  protected openFilePicker(): void {
    this.fileInput().nativeElement.click();
  }

  protected async onFilePicked(event: Event): Promise<void> {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    if (file) await this.load(file);
    el.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    const related = event.relatedTarget as Node | null;
    if (!related || !(event.currentTarget as HTMLElement).contains(related)) this.dragging.set(false);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    event.preventDefault();
    this.dragging.set(false);
    await this.load(file);
  }

  protected clear(): void {
    this.valueChange.emit('');
    this.textarea().nativeElement.focus();
  }

  private async load(file: File): Promise<void> {
    this.fileLoaded.emit({ name: file.name, size: file.size, text: await file.text() });
  }
}

let measureCanvas: HTMLCanvasElement | null = null;

function measureCharWidth(font: string): number {
  measureCanvas ??= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText('0000000000').width / 10;
}
