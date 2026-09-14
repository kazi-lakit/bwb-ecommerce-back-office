import { ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: "rounded-md bg-brand-accent text-on-dark shadow-[0_5px_14px_rgba(234,88,12,0.24)] hover:bg-brand-accent-deep disabled:bg-hairline disabled:text-muted disabled:shadow-none",
  accent: "rounded-md bg-brand-accent text-on-dark shadow-[0_5px_14px_rgba(234,88,12,0.24)] hover:bg-brand-accent-deep",
  secondary: "rounded-md border border-hairline bg-canvas text-steel hover:bg-surface hover:text-ink",
  ghost: "bg-transparent text-ink hover:bg-surface rounded-md",
  danger: "rounded-md border border-brand-error/30 bg-brand-error/10 text-brand-error hover:bg-brand-error/15",
};

const sizeClasses: Record<Size, string> = {
  md: "min-h-10 px-5 py-2.5 text-sm",
  sm: "min-h-9 px-3 py-1.5 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={clsx(
        "inline-flex items-center justify-center gap-2 font-medium leading-tight transition-colors duration-150 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
