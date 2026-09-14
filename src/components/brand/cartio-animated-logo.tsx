import { useId } from "react";
import clsx from "clsx";

interface CartioAnimatedLogoProps {
  animated?: boolean;
  compact?: boolean;
  className?: string;
}

export function CartioAnimatedLogo({ animated = false, compact = false, className }: CartioAnimatedLogoProps) {
  const instanceId = useId().replace(/:/g, "");
  const dotMaskId = `cartio-admin-dot-${instanceId}`;
  const lowerMaskId = `cartio-admin-lower-${instanceId}`;
  const upperMaskId = `cartio-admin-upper-${instanceId}`;

  return (
    <svg
      viewBox={compact ? "0 0 173 173" : "0 0 648 173"}
      role="img"
      aria-label="Cartio"
      className={clsx("cartio-header-logo h-10 w-auto overflow-visible", className)}
    >
      <defs>
        <mask id={dotMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="173" height="173">
          <g transform="translate(-14 -14) scale(.392)">
            <circle className={animated ? "cartio-header-logo__dot" : undefined} cx="417" cy="274" r="58" fill="white" />
          </g>
        </mask>
        <mask id={lowerMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="173" height="173">
          <path
            className={animated ? "cartio-header-logo__lower" : undefined}
            pathLength="1"
            d="M417 292 C407 342 369 391 316 423 C249 463 163 451 104 401 C59 363 43 304 66 267 C81 242 101 233 119 243 C139 254 144 279 158 306"
            fill="none"
            stroke="white"
            strokeWidth="210"
            strokeLinecap="round"
            strokeLinejoin="round"
            transform="translate(-14 -14) scale(.392)"
          />
        </mask>
        <mask id={upperMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="173" height="173">
          <path
            className={animated ? "cartio-header-logo__upper" : undefined}
            pathLength="1"
            d="M55 238 C85 132 180 74 282 85 C371 95 428 151 422 210 C419 239 410 258 417 274"
            fill="none"
            stroke="white"
            strokeWidth="210"
            strokeLinecap="round"
            strokeLinejoin="round"
            transform="translate(-14 -14) scale(.392)"
          />
        </mask>
      </defs>

      <use href="/cartio-logo.svg#cartio-icon-dot" fill="var(--color-brand-accent)" mask={animated ? `url(#${dotMaskId})` : undefined} />
      <use href="/cartio-logo.svg#cartio-icon-lower" fill="var(--color-ink)" mask={animated ? `url(#${lowerMaskId})` : undefined} />
      <use href="/cartio-logo.svg#cartio-icon-upper" fill="var(--color-ink)" mask={animated ? `url(#${upperMaskId})` : undefined} />

      {!compact && (
        <g fill="var(--color-ink)" fillRule="evenodd">
          <use href="/cartio-logo.svg#cartio-letter-c" className={animated ? "cartio-header-logo__letter cartio-header-logo__letter--1" : undefined} />
          <use href="/cartio-logo.svg#cartio-letter-a" className={animated ? "cartio-header-logo__letter cartio-header-logo__letter--2" : undefined} />
          <use href="/cartio-logo.svg#cartio-letter-r" className={animated ? "cartio-header-logo__letter cartio-header-logo__letter--3" : undefined} />
          <use href="/cartio-logo.svg#cartio-letter-t" className={animated ? "cartio-header-logo__letter cartio-header-logo__letter--4" : undefined} />
          <g className={animated ? "cartio-header-logo__letter cartio-header-logo__letter--5" : undefined}>
            <use href="/cartio-logo.svg#cartio-letter-i-stem" />
            <use href="/cartio-logo.svg#cartio-letter-i-dot" />
          </g>
          <use href="/cartio-logo.svg#cartio-letter-o" className={animated ? "cartio-header-logo__letter cartio-header-logo__letter--6" : undefined} />
        </g>
      )}
    </svg>
  );
}
