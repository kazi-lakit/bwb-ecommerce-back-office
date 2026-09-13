import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import clsx from "clsx";
import type { LucideProps } from "lucide-react";

export interface DropdownMenuItem {
  label: string;
  icon?: ComponentType<LucideProps>;
  onClick: () => void;
  danger?: boolean;
}

const MENU_WIDTH = 160; // matches the old `w-40`
const ITEM_HEIGHT = 36;
const VIEWPORT_MARGIN = 8;
const GAP = 4;

/**
 * A small, dependency-free kebab menu — used for per-row actions in admin tables.
 *
 * The panel is portaled to `document.body` and positioned in viewport coordinates instead of
 * living inside the trigger's own DOM position. Every admin table wraps its rows in an
 * `overflow-hidden`/`overflow-x-auto` ancestor (for the table's own scroll behavior), and a
 * plain absolutely-positioned menu nested inside that ancestor gets its lower portion clipped
 * for any row near the bottom of the table — confirmed for the last row, where the menu had
 * nowhere to open but into the pagination footer below it and was rendered invisibly there.
 * Z-index can't fix a clip: only a portal escapes the ancestor's `overflow` box. Flipping the
 * menu to open upward when there isn't room below (rather than always downward) is what then
 * keeps it on-screen for a bottom-row trigger.
 */
export function DropdownMenu({ items, label = "Row actions" }: { items: DropdownMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const estimatedHeight = items.length * ITEM_HEIGHT + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < estimatedHeight + VIEWPORT_MARGIN && rect.top > estimatedHeight;
    setPosition({
      top: openUpward ? rect.top - estimatedHeight - GAP : rect.bottom + GAP,
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN)),
    });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Closing on scroll/resize is simpler and less error-prone than continuously re-tracking
    // the trigger's position while the menu is open, and matches how most native/OS menus
    // behave when the anchor moves out from under them.
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-steel hover:bg-surface hover:text-ink"
      >
        <MoreHorizontal size={16} />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: position.top, left: position.left, width: MENU_WIDTH }}
            className="z-50 overflow-hidden rounded-md border border-hairline bg-canvas py-1 shadow-lg"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface",
                  item.danger ? "text-brand-error" : "text-ink"
                )}
              >
                {item.icon && <item.icon size={14} />}
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
