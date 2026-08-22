import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost" | "danger";
  size?: "default" | "sm" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", disabled, ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

    const variantStyles = {
      default:
        "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-200 focus-visible:ring-neutral-900 dark:focus-visible:ring-neutral-300",
      secondary:
        "bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 focus-visible:ring-neutral-500",
      outline:
        "border border-neutral-300 dark:border-neutral-700 bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus-visible:ring-neutral-500",
      ghost:
        "bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 focus-visible:ring-neutral-500",
      danger:
        "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600",
    };

    const sizeStyles = {
      default: "h-10 px-4 py-2 text-sm",
      sm: "h-8 px-3 text-xs",
      lg: "h-12 px-6 text-base",
    };

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
