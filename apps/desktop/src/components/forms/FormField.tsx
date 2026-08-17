import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
    label: string;
    htmlFor: string;
    error?: string;
    required?: boolean;
    className?: string;
    children: React.ReactNode;
}

export function FormField({
    label,
    htmlFor,
    error,
    required = false,
    className,
    children,
}: FormFieldProps) {
    return (
        <div className={cn("space-y-2", className)}>
            <Label htmlFor={htmlFor}>
                {label}
                {required && (
                    <span className="text-destructive ml-1">
                        *
                    </span>
                )}
            </Label>

            {children}

            {error && (
                <p className="text-xs leading-4 text-red-600">
                    {error}
                </p>
            )}
        </div>
    );
}

