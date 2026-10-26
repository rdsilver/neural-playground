// Form controls for the inspector. Every interactive element gets a
// data-field so the inspector can restore focus after re-rendering.

import { h } from '../dom';
import { icons } from '../icons';
import { tipped } from './tooltip';

export function section(title: string, actions: HTMLElement[], ...body: (HTMLElement | null | false)[]): HTMLElement {
  const head = h('div', { class: 'insp-head' }, h('h2', { class: 'insp-title', text: title }), ...actions);
  return h('section', { class: 'insp-section', 'aria-label': title }, head, ...body);
}

export function prop(label: string, control: HTMLElement, note?: string, labelFor?: string): HTMLElement {
  const lbl = labelFor ? h('label', { class: 'prop-label', for: labelFor, text: label }) : h('span', { class: 'prop-label', text: label });
  const row = h('div', { class: 'prop' }, lbl, control);
  if (note) row.append(h('span', { class: 'prop-note', text: note }));
  return row;
}

/** A label above a full-width control (for wide controls like the kind picker). */
export function stacked(label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'prop-stack' }, h('span', { class: 'prop-label', text: label }), control);
}

export interface StepperOptions {
  field: string;
  label: string;
  value: number | string;
  step: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  /** Parse typed text; return null to reject it. */
  parse?: (text: string) => number | null;
  /** Value shown in the box (defaults to the number). */
  format?: (value: number) => string;
  onChange: (value: number) => void;
}

/** A number box with − / + buttons. Typing commits on every valid keystroke. */
export function stepper(o: StepperOptions): HTMLElement {
  const clamp = (v: number) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
  const parse = o.parse ?? ((t: string) => (t.trim() === '' || Number.isNaN(Number(t)) ? null : Number(t)));
  const format = o.format ?? ((v: number) => String(v));
  const current = () => {
    const v = typeof o.value === 'number' ? o.value : parse(String(o.value));
    return v ?? o.min ?? 0;
  };
  const input = h('input', {
    id: `f-${o.field}`,
    'data-field': o.field,
    type: o.parse ? 'text' : 'number',
    inputmode: o.parse ? 'text' : 'decimal',
    value: typeof o.value === 'number' ? format(o.value) : o.value,
    step: o.step,
    min: o.min,
    max: o.max,
    disabled: o.disabled,
    'aria-label': o.label,
    autocomplete: 'off',
    spellcheck: 'false',
  });
  input.addEventListener('input', () => {
    const v = parse(input.value);
    if (v !== null && v >= (o.min ?? -Infinity) && v <= (o.max ?? Infinity)) o.onChange(v);
  });
  input.addEventListener('change', () => (input.value = format(current())));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = clamp(round(current() + (e.key === 'ArrowUp' ? o.step : -o.step) * (e.shiftKey ? 10 : 1)));
      o.onChange(v);
    } else if (e.key === 'Enter') input.blur();
  });
  const bump = (dir: 1 | -1, field: string) =>
    tipped(
      h('button', {
        class: 'btn',
        type: 'button',
        'data-field': field,
        html: dir > 0 ? icons.plus : icons.minus,
        disabled: o.disabled,
        'aria-label': `${dir > 0 ? 'Increase' : 'Decrease'} ${o.label.toLowerCase()}`,
        onclick: () => o.onChange(clamp(round(current() + dir * o.step))),
      }),
      dir > 0 ? 'Increase' : 'Decrease',
    );
  const box = h('div', { class: 'stepper' }, bump(-1, `${o.field}-dec`), input, bump(1, `${o.field}-inc`));
  if (o.unit) box.insertBefore(h('span', { class: 'unit', text: o.unit }), box.lastChild);
  return box;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function textInput(field: string, label: string, value: string, placeholder: string, maxLength: number, onInput: (v: string) => void): HTMLInputElement {
  const input = h('input', {
    id: `f-${field}`,
    class: 'input',
    'data-field': field,
    value,
    placeholder,
    maxlength: maxLength,
    'aria-label': label,
    autocomplete: 'off',
    spellcheck: 'false',
  });
  input.addEventListener('input', () => onInput(input.value));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  return input;
}

/** Segmented control (radio-like row of buttons). */
export function segmented<T extends string>(field: string, label: string, options: { value: T; label: string }[], current: T, onPick: (v: T) => void): HTMLElement {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const o of options) {
    seg.append(
      h('button', {
        type: 'button',
        'data-field': `${field}-${o.value}`,
        'aria-pressed': String(o.value === current),
        text: o.label,
        onclick: () => onPick(o.value),
      }),
    );
  }
  return seg;
}

export function toggle(field: string, label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', role: 'switch', 'data-field': field, checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), label);
}

export function iconButton(field: string, icon: keyof typeof icons, label: string, onClick: () => void, cls = 'btn small outline', keys?: string): HTMLButtonElement {
  return tipped(
    h('button', { class: cls, type: 'button', 'data-field': field, onclick: onClick }, h('span', { html: icons[icon] }), label),
    label,
    keys,
  );
}
