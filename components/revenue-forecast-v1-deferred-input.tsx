"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Text input: local string until blur or Enter — avoids parent re-render fighting keystrokes.
 */
export function DeferredTextInput(props: {
  resetKey: string;
  placeholder?: string;
  className?: string;
  onCommit: (value: string) => void;
  /** Initial / external value to show when not focused (e.g. after add clears parent). */
  externalValue?: string;
}) {
  const { resetKey, placeholder, className, onCommit, externalValue = "" } = props;
  const [local, setLocal] = useState(externalValue);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setLocal(externalValue);
  }, [resetKey, externalValue]);

  const commit = useCallback(() => {
    onCommit(local.trim());
  }, [local, onCommit]);

  return (
    <input
      type="text"
      value={local}
      placeholder={placeholder}
      className={className}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setLocal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/**
 * Generic decimal / percent string; commits parsed number on blur. While typing, any string allowed.
 */
export function DeferredNumberCommitInput(props: {
  resetKey: string;
  committed: number | undefined | null;
  onCommit: (n: number | undefined) => void;
  className?: string;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  const { resetKey, committed, onCommit, className, min, max, placeholder } = props;
  const format = (v: number | undefined | null) =>
    v != null && Number.isFinite(Number(v)) ? String(Number(v)) : "";
  const [local, setLocal] = useState(() => format(committed));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setLocal(format(committed));
  }, [resetKey, committed]);

  const applyBounds = (n: number) => {
    let x = n;
    if (min != null) x = Math.max(min, x);
    if (max != null) x = Math.min(max, x);
    return x;
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      className={className}
      value={local}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        const t = local.trim().replace(/,/g, "");
        if (t === "") {
          onCommit(undefined);
          setLocal("");
          return;
        }
        const n = parseFloat(t);
        if (!Number.isFinite(n)) {
          setLocal(format(committed));
          return;
        }
        const v = applyBounds(n);
        onCommit(v);
        setLocal(String(v));
      }}
      onChange={(e) => setLocal(e.target.value)}
    />
  );
}

/**
 * Stored currency amount: display in reporting units while editing freeform; commit stored value on blur.
 */
export function DeferredStoredAmountInput(props: {
  resetKey: string;
  storedCommitted: number | undefined | null;
  onCommitStored: (stored: number | undefined) => void;
  displayToStored: (display: number) => number;
  storedToDisplay: (stored: number) => number;
  className?: string;
  placeholder?: string;
}) {
  const { resetKey, storedCommitted, onCommitStored, displayToStored, storedToDisplay, className, placeholder } = props;
  const toDisplayStr = (s: number | undefined | null) =>
    s != null && Number.isFinite(Number(s)) ? String(storedToDisplay(Number(s))) : "";
  const [local, setLocal] = useState(() => toDisplayStr(storedCommitted));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setLocal(toDisplayStr(storedCommitted));
  }, [resetKey, storedCommitted]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      className={className}
      value={local}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        const t = local.trim().replace(/,/g, "");
        if (t === "") {
          onCommitStored(undefined);
          setLocal("");
          return;
        }
        const display = parseFloat(t);
        if (!Number.isFinite(display)) {
          setLocal(toDisplayStr(storedCommitted));
          return;
        }
        const stored = displayToStored(display);
        onCommitStored(stored);
        setLocal(String(storedToDisplay(stored)));
      }}
      onChange={(e) => setLocal(e.target.value)}
    />
  );
}

export function RevenueForecastLineNameAdd(props: {
  placeholder: string;
  buttonLabel: string;
  className?: string;
  inputClassName?: string;
  onAdd: (trimmedName: string) => void;
}) {
  const { placeholder, buttonLabel, className, inputClassName, onAdd } = props;
  const [v, setV] = useState("");
  return (
    <div className={className ?? "flex flex-wrap items-center gap-2"}>
      <input
        type="text"
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const t = v.trim();
            if (t) {
              onAdd(t);
              setV("");
            }
          }
        }}
        className={inputClassName ?? "rounded border border-slate-600 bg-slate-800 text-xs px-3 py-1.5 w-64"}
      />
      <button
        type="button"
        onClick={() => {
          const t = v.trim();
          if (t) {
            onAdd(t);
            setV("");
          }
        }}
        className="rounded border border-slate-600 bg-slate-700 text-xs text-slate-200 px-3 py-1.5 hover:bg-slate-600"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
