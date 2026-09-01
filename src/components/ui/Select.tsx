"use client";

import { useEffect, useId, useRef, useState } from "react";
import { inputClass } from "@/components/ui/Field";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  id?: string;
  name: string;
  options: SelectOption[];
  className?: string;
  required?: boolean;
  /** 未提供 value 時走 uncontrolled 模式，行為對齊原生 <select defaultValue> */
  defaultValue?: string;
  /** 提供 value 時走 controlled 模式，須同時提供 onChange，行為對齊原生 <select value onChange> */
  value?: string;
  onChange?: (value: string) => void;
}

const CHEVRON_PATH = "M5.5 7.5L10 12L14.5 7.5";

/**
 * 取代原生 <select>——展開後的選項清單原生元素不給 CSS 接管樣式（平台
 * 限制），只能維持系統原生外觀，跟其餘欄位的「紙本手帳感」設計語言不搭。
 * 改成自建的 collapsible listbox（button 觸發 + role="listbox" 選單，
 * ARIA 1.2 慣用模式）：焦點一律留在觸發按鈕上，用 aria-activedescendant
 * 指向目前反白的選項，不把焦點移進選單——鍵盤/螢幕閱讀器都能正確運作，
 * 也不必額外處理焦點移出移入選單的邊界情況。
 *
 * 用一個隱藏的 <input type="hidden" name=...> 承載實際送出的值，讓這個
 * 元件不管是放進原生 <form method="get">（如 ExpenseFilters，本來零 JS）
 * 還是 Server Action 表單，欄位語意都跟原生 <select> 一致，呼叫端不用
 * 改任何表單送出邏輯。
 */
export function Select({
  id,
  name,
  options,
  className = "",
  required,
  defaultValue,
  value: controlledValue,
  onChange,
}: SelectProps) {
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? options[0]?.value ?? "");
  const value = isControlled ? controlledValue : internalValue;

  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(() =>
    Math.max(
      options.findIndex((option) => option.value === value),
      0,
    ),
  );

  const reactId = useId();
  const listId = `${reactId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selectedOption = options.find((option) => option.value === value);

  function commit(nextValue: string) {
    if (!isControlled) setInternalValue(nextValue);
    onChange?.(nextValue);
  }

  function openList() {
    setHighlightIndex(
      Math.max(
        options.findIndex((option) => option.value === value),
        0,
      ),
    );
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setHighlightIndex(0);
        break;
      case "End":
        event.preventDefault();
        setHighlightIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (options[highlightIndex] !== undefined) commit(options[highlightIndex].value);
        setOpen(false);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={value} required={required} />
      <button
        ref={buttonRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${highlightIndex}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        className={`${inputClass} flex w-full items-center justify-between gap-2 text-left ${className}`}
      >
        <span className="truncate">{selectedOption?.label ?? ""}</span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d={CHEVRON_PATH}
            stroke="#5f5e5a"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          tabIndex={-1}
          className="absolute z-20 mt-1 max-h-60 w-full min-w-max overflow-auto rounded-md border border-washi bg-white py-1 shadow-lg"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setHighlightIndex(index)}
              onClick={() => {
                commit(option.value);
                setOpen(false);
                buttonRef.current?.focus();
              }}
              className={`cursor-pointer px-3 py-1.5 text-sm ${
                index === highlightIndex ? "bg-stamp-pale" : ""
              } ${option.value === value ? "font-medium text-stamp" : "text-ink"}`}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
