import * as React from "react";
import { cn } from "@/lib/utils";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "text-sm font-medium text-neutral-800 dark:text-neutral-200 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          className
        )}
        {...props}
      />
    );
  }
);

Label.displayName = "Label";
