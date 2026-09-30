import * as React from "react";

import { cn } from "@/lib/utils";

type SwitchProps = {
    checked?: boolean;
    defaultChecked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    className?: string;
};

function Switch({
    checked,
    defaultChecked = false,
    disabled = false,
    onCheckedChange,
    className,
}: SwitchProps) {
    const [internalChecked, setInternalChecked] =
        React.useState(defaultChecked);

    const isControlled = checked !== undefined;
    const isChecked = isControlled ? checked : internalChecked;

    const handleClick = () => {
        if (disabled) {
            return;
        }

        const nextValue = !isChecked;

        if (!isControlled) {
            setInternalChecked(nextValue);
        }

        onCheckedChange?.(nextValue);
    };

    return (
        <button
            type="button"
            role="switch"
            aria-checked={isChecked}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={handleClick}
            className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors outline-none",
                "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                isChecked
                    ? "border-blue-600 bg-blue-600"
                    : "border-slate-300 bg-slate-200",
                className,
            )}
        >
            <span
                className={cn(
                    "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                    isChecked
                        ? "translate-x-5"
                        : "translate-x-0.5",
                )}
            />
        </button>
    );
}

export { Switch };
