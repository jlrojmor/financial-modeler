"use client";

import { forwardRef, useCallback, useRef } from "react";
import {
  formatNumberInputDisplayOnBlur,
  stripNumberGrouping,
} from "@/lib/revenue-forecast-numeric-format";

export type RevenueForecastDecimalInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: string;
  onChange: (next: string) => void;
};

function assignRefs<T>(el: T | null, refs: Array<React.Ref<T> | null | undefined>) {
  for (const r of refs) {
    if (!r) continue;
    if (typeof r === "function") (r as (instance: T | null) => void)(el);
    else (r as React.MutableRefObject<T | null>).current = el;
  }
}

/**
 * Controlled numeric string: strips commas on focus (caret preserved); formats on blur.
 * Parent state is the source of truth; parse with stripNumberGrouping before commit.
 */
export const RevenueForecastDecimalInput = forwardRef<HTMLInputElement, RevenueForecastDecimalInputProps>(
  function RevenueForecastDecimalInput({ value, onChange, onFocus, onBlur, ...rest }, ref) {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFocus = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        const el = e.target;
        const stripped = stripNumberGrouping(el.value);
        if (stripped !== el.value) {
          const caret = el.selectionStart ?? stripped.length;
          const before = el.value.slice(0, caret);
          const newCaret = stripNumberGrouping(before).length;
          onChange(stripped);
          queueMicrotask(() => {
            const node = inputRef.current;
            if (!node) return;
            const pos = Math.min(Math.max(0, newCaret), stripped.length);
            node.setSelectionRange(pos, pos);
          });
        }
        onFocus?.(e);
      },
      [onChange, onFocus]
    );

    const handleBlur = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        const formatted = formatNumberInputDisplayOnBlur(e.target.value);
        onChange(formatted);
        onBlur?.(e);
      },
      [onChange, onBlur]
    );

    return (
      <input
        ref={(el) => assignRefs(el, [inputRef, ref])}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...rest}
      />
    );
  }
);
