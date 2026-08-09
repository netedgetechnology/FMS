import { ReactNode } from "react";

export interface FormGridProps {
    children: ReactNode;
}

export function FormGrid({
    children,
}: FormGridProps) {
    return (
        <div className="grid gap-4 md:grid-cols-2">
            {children}
        </div>
    );
}
