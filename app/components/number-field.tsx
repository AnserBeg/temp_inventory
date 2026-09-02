"use client";

import { useState, type ChangeEvent, type FocusEvent, type InputHTMLAttributes } from "react";

/**
 * A numeric input that can actually be emptied.
 *
 * Binding `<input type="number" value={n} onChange={(e) => set(Number(e.target.value))}>` snaps
 * the field back to 0 the moment it is cleared, so retyping a quantity meant selecting the digit
 * first. This keeps the text being typed while the field has focus, hands the parent a number
 * only when that text parses (an empty field counts as `emptyValue`, 0 by default), and resyncs
 * from the prop once focus leaves. min / max / step pass straight through to the input.
 */
export type NumberFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onChange: (value: number) => void;
  /** What the parent receives while the field is empty. */
  emptyValue?: number;
};

/** The number a typed draft stands for, or undefined while it is not yet a number ("-", "1e"). */
export function parseNumberDraft(text: string, emptyValue = 0): number | undefined {
  if (text.trim() === "") return emptyValue;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function NumberField({ value, onChange, emptyValue = 0, onFocus, onBlur, ...rest }: NumberFieldProps) {
  // null = not being edited; the prop is what is shown.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : "");
  return <input
    type="number"
    {...rest}
    value={shown}
    onFocus={(event: FocusEvent<HTMLInputElement>) => { setDraft(shown); onFocus?.(event); }}
    onChange={(event: ChangeEvent<HTMLInputElement>) => {
      const text = event.target.value;
      setDraft(text);
      const parsed = parseNumberDraft(text, emptyValue);
      if (parsed !== undefined && parsed !== value) onChange(parsed);
    }}
    onBlur={(event: FocusEvent<HTMLInputElement>) => { setDraft(null); onBlur?.(event); }}
  />;
}
