import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/forms";

import type { SetupIssue } from "../../setup/loanSetupTypes";

// Small building blocks shared by every Add Loan step.

/**
 * A section of a loan form (Add Loan steps, statement review): ONE boxed
 * container - subtle blue-grey background, thin border, rounded corners -
 * wrapping the heading, its description and every field, so each category
 * reads as a unit and its heading sits clearly above the field labels
 * (text-xs / text-sm, medium weight). Inputs keep their own white
 * background and border. Consecutive sections are spaced by their parent.
 *
 * `variant="plain"` is the read-only layout of the View Loan dialog
 * (LoanSetupSummary), matching that dialog's own unboxed sections.
 */
export function StepSection({
    title,
    hint,
    variant = "box",
    children,
}: {
    title: string;
    hint?: string;
    variant?: "box" | "plain";
    children: ReactNode;
}) {
    if (variant === "plain") {
        return (
            <section className="space-y-2.5">
                <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
                    <div className="h-px flex-1 bg-slate-100" />
                </div>
                {hint && <p className="text-xs text-slate-500">{hint}</p>}
                {children}
            </section>
        );
    }

    return (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="space-y-1">
                <h3 className="text-[15px] font-semibold leading-6 text-slate-900">{title}</h3>
                {hint && <p className="text-xs leading-5 text-slate-500">{hint}</p>}
            </div>
            {children}
        </section>
    );
}

export function issueFor(issues: readonly SetupIssue[], field: string): string | undefined {
    return issues.find(issue => issue.field === field)?.message;
}

/**
 * A number input that keeps what the user is typing ("10.0", "1,") while
 * reporting a number - or null when blank - to the draft. A controlled
 * <input type="number"> fed straight from a number would drop a trailing
 * "0" mid-typing and turn "10.05" into "105".
 */
export function NumberField({
    id,
    value,
    onChange,
    placeholder,
    step = "0.01",
    min = "0",
    disabled,
}: {
    id: string;
    value: number | null;
    onChange(value: number | null): void;
    placeholder?: string;
    step?: string;
    min?: string;
    disabled?: boolean;
}) {
    const [text, setText] = useState(value === null ? "" : String(value));

    useEffect(() => {
        const current = text.trim() === "" ? null : Number(text);
        if (current !== value && !(Number.isNaN(current) && value === null)) {
            setText(value === null ? "" : String(value));
        }
        // Only an outside change of `value` resets the text.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={min}
            step={step}
            placeholder={placeholder}
            disabled={disabled}
            value={text}
            onChange={event => {
                const next = event.target.value;
                setText(next);
                if (next.trim() === "") {
                    onChange(null);
                } else if (Number.isFinite(Number(next))) {
                    onChange(Number(next));
                }
            }}
        />
    );
}

export interface ChoiceOption {
    value: string;
    label: string;
}

export function ChoiceSelect({
    id,
    value,
    options,
    onChange,
    placeholder = "Select",
    disabled,
}: {
    id: string;
    value: string;
    options: readonly ChoiceOption[];
    onChange(value: string): void;
    placeholder?: string;
    disabled?: boolean;
}) {
    const selected = options.find(option => option.value === value);

    return (
        <Select value={value || ""} onValueChange={next => onChange(String(next ?? ""))} disabled={disabled}>
            <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder={placeholder}>{selected ? selected.label : null}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                {options.map(option => (
                    <SelectItem key={option.value} value={option.value} label={option.label}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export function Field({
    label,
    htmlFor,
    required,
    error,
    hint,
    className,
    children,
}: {
    label: string;
    htmlFor: string;
    required?: boolean;
    error?: string;
    hint?: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <FormField label={label} htmlFor={htmlFor} required={required} error={error} className={className}>
            {children}
            {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </FormField>
    );
}

export function IssueList({ issues, tone = "error" }: { issues: readonly SetupIssue[]; tone?: "error" | "warning" }) {
    if (issues.length === 0) return null;

    const styles =
        tone === "error"
            ? "border-red-100 bg-red-50 text-red-700"
            : "border-amber-100 bg-amber-50 text-amber-800";

    return (
        <ul className={`space-y-1 rounded-lg border px-3 py-2 text-sm ${styles}`}>
            {issues.map((issue, index) => (
                <li key={`${issue.field}-${index}`}>{issue.message}</li>
            ))}
        </ul>
    );
}

export function SummaryGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
    return (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm sm:grid-cols-3">
            {items.map(item => (
                <div key={item.label}>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">{item.label}</div>
                    <div className="font-semibold text-slate-900">{item.value}</div>
                </div>
            ))}
        </div>
    );
}

export function SmallButton({
    children,
    onClick,
    tone = "default",
    disabled,
}: {
    children: ReactNode;
    onClick(): void;
    tone?: "default" | "danger" | "primary";
    disabled?: boolean;
}) {
    const styles = {
        default: "border border-slate-200 text-slate-700 hover:bg-slate-50",
        danger: "border border-red-100 text-red-600 hover:bg-red-50",
        primary: "bg-slate-900 text-white hover:bg-slate-800",
    }[tone];

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`h-8 rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
        >
            {children}
        </button>
    );
}

export function formatDisplayDate(iso: string | null | undefined): string {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "-";
    const [year, month, day] = iso.slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
}
