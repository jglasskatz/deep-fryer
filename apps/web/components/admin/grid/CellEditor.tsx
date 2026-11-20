'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { columnChoices, parseClipboard, type EditableColumnKey } from '@/lib/spreadsheet-import';

/*
 * The box a table cell turns into while its text is being changed: a text
 * box for free text, a menu for Scale and Confidence. Keys work as in a
 * spreadsheet: Enter keeps the text and moves down, Tab keeps it and moves
 * right (Shift+Tab left), Escape puts the cell back as it was, and leaving
 * the box keeps the text. Shift+Enter or Alt+Enter starts a new line.
 */

export type CommitMove = 'down' | 'right' | 'left' | 'stay';

export interface CellEditorProps {
  column: EditableColumnKey;
  /** The text the box starts with: the cell's text, or the key typed to start editing (editorStartText). */
  initialText: string;
  /** Names the box for screen readers: the column and the indicator. */
  label: string;
  /** The problem the cell has, read out with the box. */
  describedBy?: string;
  onCommit: (text: string, move: CommitMove) => void;
  onCancel: () => void;
  /** Cells copied from a spreadsheet and pasted into the box: laid over the table from this cell. */
  onPasteBlock: (block: string[][]) => void;
}

/** Whether pasted text came from a spreadsheet's cells (several cells, or the program's own table) rather than plain words. */
export function isSpreadsheetPaste(text: string, html: string): boolean {
  if (text.includes('\t')) return true;
  return /<table[\s>]/i.test(html) && parseClipboard(text).length > 1;
}

const BOX =
  'block w-full min-w-[8rem] rounded border-2 border-[color:var(--color-accent)] bg-white px-2 py-1 text-base text-[color:var(--color-fg)] sm:text-sm';

export function CellEditor({ column, initialText, label, describedBy, onCommit, onCancel, onPasteBlock }: CellEditorProps) {
  const [text, setText] = useState(initialText);
  const done = useRef(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const choices = columnChoices(column);
  /** The choice the text names, by its stored word, or undefined when it names none. */
  const chosen = choices?.find((c) => c.value === text.trim().toLowerCase() || c.label.toLowerCase() === text.trim().toLowerCase());

  useEffect(() => {
    if (choices) {
      selectRef.current?.focus();
      return;
    }
    const box = textRef.current;
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [choices]);

  const commit = (move: CommitMove) => {
    if (done.current) return;
    done.current = true;
    // A menu showing "Choose…" has nothing chosen: the cell stays as it was, rather than taking text nobody saw.
    if (choices && !chosen) onCancel();
    else onCommit(text, move);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement | HTMLSelectElement>) => {
    // Keys typed here are the box's, not the table's.
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      commit('down');
    } else if (event.key === 'Enter' && event.altKey && !choices) {
      // Alt+Enter is a new line in a spreadsheet cell; the browser does not add one itself.
      event.preventDefault();
      const box = event.currentTarget as HTMLTextAreaElement;
      const at = box.selectionStart;
      const next = `${text.slice(0, at)}\n${text.slice(box.selectionEnd)}`;
      setText(next);
      requestAnimationFrame(() => box.setSelectionRange(at + 1, at + 1));
    } else if (event.key === 'Tab') {
      event.preventDefault();
      commit(event.shiftKey ? 'left' : 'right');
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text/plain');
    if (!isSpreadsheetPaste(pasted, event.clipboardData.getData('text/html'))) return;
    event.preventDefault();
    done.current = true;
    onPasteBlock(parseClipboard(pasted));
  };

  if (choices) {
    return (
      <select
        ref={selectRef}
        aria-label={label}
        aria-describedby={describedBy}
        className={`${BOX} min-h-11`}
        value={chosen?.value ?? ''}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit('stay')}
      >
        <option value="" disabled>
          Choose…
        </option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }

  const lines = Math.min(6, Math.max(1, text.split('\n').length, Math.ceil(text.length / 28)));
  return (
    <textarea
      ref={textRef}
      aria-label={label}
      aria-describedby={describedBy}
      className={`${BOX} min-h-11 resize-y`}
      rows={lines}
      value={text}
      spellCheck={column === 'indicator' || column === 'source' || column === 'unit'}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onBlur={() => commit('stay')}
    />
  );
}
