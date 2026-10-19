import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { repairCategory, repairLabel, type Repair, type RepairCategory } from '../../../core';
import { CATEGORY_ICONS, CATEGORY_LABELS } from '../../shared/repair-icons';
import { Icon } from '../icon/icon';

/** The list is virtualized by truncation: thousands of DOM rows help nobody. */
const MAX_VISIBLE = 500;

interface Row {
  readonly index: number;
  readonly repair: Repair;
  readonly category: RepairCategory;
  readonly label: string;
}

@Component({
  selector: 'app-repair-list',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './repair-list.html',
  styleUrl: './repair-list.scss',
})
export class RepairList {
  readonly repairs = input<readonly Repair[]>([]);
  readonly activeIndex = input<number | null>(null);
  readonly summary = input('');
  readonly valid = input(false);
  readonly error = input<string | undefined>(undefined);
  readonly busy = input(false);
  readonly progress = input<number | null>(null);

  readonly selectRepair = output<number>();

  protected readonly percent = computed(() => Math.round((this.progress() ?? 0) * 100));
  protected readonly filter = signal<RepairCategory | null>(null);
  protected readonly icons = CATEGORY_ICONS;
  protected readonly categoryLabels = CATEGORY_LABELS;

  protected readonly rows = computed<Row[]>(() =>
    this.repairs().map((repair, index) => ({
      index,
      repair,
      category: repairCategory(repair.kind),
      label: repairLabel(repair.kind),
    })),
  );

  protected readonly categories = computed(() => {
    const counts = new Map<RepairCategory, number>();
    for (const r of this.rows()) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return [...counts.entries()].map(([category, count]) => ({ category, count }));
  });

  protected readonly filtered = computed(() => {
    const f = this.filter();
    const rows = f ? this.rows().filter((r) => r.category === f) : this.rows();
    return rows.slice(0, MAX_VISIBLE);
  });

  protected readonly hidden = computed(() => {
    const f = this.filter();
    const total = f ? this.rows().filter((r) => r.category === f).length : this.rows().length;
    return Math.max(0, total - MAX_VISIBLE);
  });

  protected toggleFilter(category: RepairCategory): void {
    this.filter.update((f) => (f === category ? null : category));
  }

  protected display(text: string): string {
    if (text === '') return '∅';
    return text.replace(/\n/g, '⏎').replace(/\t/g, '⇥');
  }
}
