import type { RepairCategory } from '../../core';
import type { IconName } from '../components/icon/icon';

export const CATEGORY_ICONS: Record<RepairCategory, IconName> = {
  wrapper: 'scissors',
  structure: 'braces',
  comment: 'message',
  quotes: 'quote',
  literal: 'wand',
  string: 'type',
  truncation: 'bandage',
};

export const CATEGORY_LABELS: Record<RepairCategory, string> = {
  wrapper: 'Wrapper & chatter',
  structure: 'Structure',
  comment: 'Comments',
  quotes: 'Quotes & keys',
  literal: 'Literals & numbers',
  string: 'String contents',
  truncation: 'Truncation',
};
