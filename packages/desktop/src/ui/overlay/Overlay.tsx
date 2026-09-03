import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Matches `ly-dialog-out`; the unmount has to be timed against it. */
const EXIT_MS = 130;

/** Shared shell for the app's floating panels: click-outside, Escape, and a centred card. */
export function Overlay({
  children,
  onClose,
  align = "center",
  width = 460,
}: {
  children: React.ReactNode;
  onClose: () => void;
  align?: "center" | "bottom";
  width?: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  /*
   * Closing is animated, so it cannot be the same instant as being closed.
   *
   * `leaving` runs the backdrop and the card out along the path they came in on, and only then does
   * the parent get told. Without it the dialog was there and then was not — which is fine for a
   * menu and wrong for something that took a decision to open.
   */
  const [leaving, setLeaving] = useState(false);
  const dismiss = useCallback(() => {
    setLeaving((already) => {
      if (already) return already;
      window.setTimeout(onClose, EXIT_MS);
      return true;
    });
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  /*
   * Rendered at the document root.
   *
   * `position: fixed` is relative to the nearest ancestor that established a containing block,
   * and `backdrop-filter` establishes one — so an overlay opened from inside a glass popover
   * was positioned and clipped by that popover instead of covering the window. A portal puts
   * it where it means to be, whoever opened it.
   */
  return createPortal(
    <div
      /*
       * Above the menus, below the toasts.
       *
       * A modal that a popover can paint over is not a modal — and one of these is now raised from
       * a menu row often enough for the two to meet (卸载 in the plugin menu, 删除 in the file
       * tree). Menus are 60; toasts are `TOAST_Z`, and they outrank this on purpose, since a
       * failure raised *by* the dialog has to be readable over it.
       */
      className={`fixed inset-0 z-[80] flex justify-center px-4 sm:px-8 ${
        align === "center" ? "items-center" : "items-end pb-[120px]"
      } ${leaving ? "ly-scrim-out" : "ly-scrim-in"}`}
      onMouseDown={(event) => {
        if (!cardRef.current?.contains(event.target as Node)) dismiss();
      }}
    >
      <div
        ref={cardRef}
        /*
         * Announced as what it is.
         *
         * The scrim already stops the rest of the window from being clicked; saying so is what
         * makes anything reading the page rather than looking at it treat the card the same way —
         * and it is how a test can ask "is a question on screen" without knowing which one.
         */
        role="dialog"
        aria-modal
        // The width is a preference, not a promise — a 460px card does not fit a 380px window.
        style={{ width, maxWidth: "100%" }}
        className={`max-h-[80vh] overflow-hidden rounded-[14px] border border-line bg-float shadow-2xl shadow-black/50 ${leaving ? "ly-dialog-out" : "ly-dialog-in"}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
