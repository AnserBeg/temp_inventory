"use client";

import { useEffect, useRef } from "react";

/**
 * Every dialog in the app hand-rolled its own chrome and none of them handled Escape, so a
 * dialog could only be dismissed by finding its × button. The keyboard hint in the search
 * palette already promised Esc worked.
 *
 * The handlers form a stack rather than each dialog listening independently, because the
 * quick-create picker opens on top of the order composer: one Escape should close the picker
 * and leave the order underneath alone.
 */
const dismissStack: Array<() => void> = [];
/** The page's own overflow, captured when the first dialog opens and restored when the last closes. */
let pageOverflow = "";

function handleEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const topmost = dismissStack[dismissStack.length - 1];
  if (!topmost) return;
  // A picker with its list open owns this Escape: the key closes the list and nothing else.
  // Without this check the capture listener swallowed the key before the combobox saw it, so
  // Escape on an open list did nothing at all.
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[aria-expanded="true"]')) return;
  // Stop the key reaching a parent dialog that is still mounted behind this one.
  event.stopPropagation();
  topmost();
}

/**
 * Closes the dialog on Escape and holds the page behind it still while it is open.
 * `busy` suppresses dismissal mid-post so a command cannot be abandoned after it is sent.
 */
export function useDialogDismiss(onClose: () => void, busy = false) {
  // Held in a ref so the document listener is registered once per dialog rather than being torn
  // down and re-added on every keystroke that changes `busy` or reidentifies `onClose`.
  const latest = useRef({ onClose, busy });
  useEffect(() => { latest.current = { onClose, busy }; }, [onClose, busy]);

  useEffect(() => {
    const dismiss = () => { if (!latest.current.busy) latest.current.onClose(); };
    if (!dismissStack.length) {
      document.addEventListener("keydown", handleEscape, true);
      // Captured once, by the first dialog. Each dialog restoring what it saw at mount meant a
      // stacked pair closing together put back "hidden" and left the page unscrollable.
      pageOverflow = document.body.style.overflow;
    }
    dismissStack.push(dismiss);
    document.body.style.overflow = "hidden";
    return () => {
      const index = dismissStack.indexOf(dismiss);
      if (index >= 0) dismissStack.splice(index, 1);
      if (!dismissStack.length) {
        document.removeEventListener("keydown", handleEscape, true);
        document.body.style.overflow = pageOverflow;
      }
    };
  }, []);
}
