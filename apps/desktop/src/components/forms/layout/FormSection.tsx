import { ReactNode } from "react";

export interface FormSectionProps {
    title: string;
    children: ReactNode;
}

export function FormSection({
    title,
    children,
}: FormSectionProps) {
    return (
        <section className="space-y-4">
            <h3 className="text-base font-semibold border-b pb-2">
                {title}
            </h3>

            {children}
        </section>
    );
}
