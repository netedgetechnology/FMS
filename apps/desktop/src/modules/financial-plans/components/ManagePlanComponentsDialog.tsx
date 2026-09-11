import { useState } from "react";
import { toast } from "sonner";
import {
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    Pencil,
    Plus,
    Trash2,
} from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { FinancialPlanComponentService } from "../services";
import {
    allowedRolesFor,
    componentTargetsAllowed,
    getPlanComponentComboLabel,
    getPlanComponentRoleLabel,
    PLAN_COMPONENT_UNAVAILABLE_LABELS,
} from "../constants";
import { usePlanComponents } from "../hooks";
import type {
    FinancialPlan,
    FinancialPlanComponentView,
    PlanComponentRole,
} from "../types";

import { PlanComponentForm } from "./PlanComponentForm";

export interface ManagePlanComponentsDialogProps {
    plan: FinancialPlan | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ManagePlanComponentsDialog({
    plan,
    open,
    onOpenChange,
}: ManagePlanComponentsDialogProps) {
    const { components, loading, refresh } =
        usePlanComponents(
            open && plan ? plan.id : null
        );

    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<
        string | null
    >(null);
    const [busy, setBusy] = useState(false);

    const service = new FinancialPlanComponentService();

    if (!plan) {
        return null;
    }

    async function withBusy(
        run: () => Promise<void>
    ) {
        setBusy(true);

        try {
            await run();
            await refresh();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Action failed."
            );
        } finally {
            setBusy(false);
        }
    }

    async function move(
        index: number,
        direction: -1 | 1
    ) {
        const next = index + direction;

        if (next < 0 || next >= components.length) {
            return;
        }

        const ordered = components.map(
            component => component.id
        );

        [ordered[index], ordered[next]] = [
            ordered[next],
            ordered[index],
        ];

        await withBusy(() =>
            service.reorder({
                planId: plan!.id,
                orderedIds: ordered,
            })
        );
    }

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                if (!busy) {
                    onOpenChange(next);

                    if (!next) {
                        setAdding(false);
                        setEditingId(null);
                    }
                }
            }}
        >
            <DialogContent
                showCloseButton={!busy}
                className="flex w-[820px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-48px)] flex-col gap-0 overflow-hidden rounded-[28px] border border-slate-100 bg-white p-0 shadow-lg"
            >
                <DialogHeader className="shrink-0 px-7 pb-4 pt-5">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Plan Components — {plan.name}
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        The sources whose live financial
                        position feeds this plan. A plan
                        with no components is valid.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    {loading && (
                        <p className="text-sm text-slate-400">
                            Loading components...
                        </p>
                    )}

                    {!loading &&
                        components.length === 0 &&
                        !adding && (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center">
                                <p className="text-sm text-slate-500">
                                    No components yet.
                                </p>
                            </div>
                        )}

                    {!loading &&
                        components.length > 0 && (
                            <ul className="space-y-2">
                                {components.map(
                                    (
                                        component,
                                        index
                                    ) => (
                                        <ComponentRow
                                            key={
                                                component.id
                                            }
                                            plan={plan}
                                            component={
                                                component
                                            }
                                            index={
                                                index
                                            }
                                            total={
                                                components.length
                                            }
                                            busy={busy}
                                            editing={
                                                editingId ===
                                                component.id
                                            }
                                            onEdit={() =>
                                                setEditingId(
                                                    prev =>
                                                        prev ===
                                                        component.id
                                                            ? null
                                                            : component.id
                                                )
                                            }
                                            onMove={move}
                                            onSaved={async () => {
                                                setEditingId(
                                                    null
                                                );
                                                await refresh();
                                            }}
                                            onToggleActive={() =>
                                                withBusy(
                                                    () =>
                                                        service.setActive(
                                                            component.id,
                                                            !component.isActive
                                                        )
                                                )
                                            }
                                            onDelete={() =>
                                                withBusy(
                                                    () =>
                                                        service.delete(
                                                            component.id
                                                        )
                                                )
                                            }
                                        />
                                    )
                                )}
                            </ul>
                        )}

                    {adding ? (
                        <PlanComponentForm
                            plan={plan}
                            onCreated={async () => {
                                setAdding(false);
                                await refresh();
                            }}
                            onCancel={() =>
                                setAdding(false)
                            }
                        />
                    ) : (
                        <button
                            type="button"
                            onClick={() =>
                                setAdding(true)
                            }
                            disabled={busy}
                            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                            <Plus size={15} />
                            Add Component
                        </button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface ComponentRowProps {
    plan: FinancialPlan;
    component: FinancialPlanComponentView;
    index: number;
    total: number;
    busy: boolean;
    editing: boolean;
    onEdit: () => void;
    onMove: (
        index: number,
        direction: -1 | 1
    ) => void;
    onSaved: () => Promise<void> | void;
    onToggleActive: () => void;
    onDelete: () => void;
}

function ComponentRow({
    plan,
    component,
    index,
    total,
    busy,
    editing,
    onEdit,
    onMove,
    onSaved,
    onToggleActive,
    onDelete,
}: ComponentRowProps) {
    const title =
        component.label ||
        component.sourceName ||
        "Unknown source";

    return (
        <li className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-start gap-3">
                <div className="flex flex-col gap-0.5 pt-0.5">
                    <button
                        type="button"
                        onClick={() =>
                            onMove(index, -1)
                        }
                        disabled={busy || index === 0}
                        className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        aria-label="Move up"
                    >
                        <ChevronUp size={14} />
                    </button>

                    <button
                        type="button"
                        onClick={() =>
                            onMove(index, 1)
                        }
                        disabled={
                            busy ||
                            index === total - 1
                        }
                        className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        aria-label="Move down"
                    >
                        <ChevronDown size={14} />
                    </button>
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">
                            {title}
                        </span>

                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            {getPlanComponentComboLabel(
                                component.componentType,
                                component.role
                            )}
                        </span>

                        {!component.isActive && (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                Inactive
                            </span>
                        )}

                        {!component.available && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                <AlertTriangle
                                    size={11}
                                />
                                {component.unavailableReason
                                    ? (PLAN_COMPONENT_UNAVAILABLE_LABELS[
                                          component
                                              .unavailableReason
                                      ] ??
                                      "Unavailable")
                                    : "Unavailable"}
                            </span>
                        )}
                    </div>

                    <div className="mt-1 text-xs text-slate-400">
                        {component.sourceName ??
                            "source unavailable"}
                        {component.targetAmount !==
                        null
                            ? ` · target ${component.targetAmount}`
                            : ""}
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={onToggleActive}
                        disabled={busy}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                        {component.isActive
                            ? "Deactivate"
                            : "Activate"}
                    </button>

                    <button
                        type="button"
                        onClick={onEdit}
                        disabled={busy}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        aria-label="Edit component"
                    >
                        <Pencil size={13} />
                    </button>

                    <button
                        type="button"
                        onClick={onDelete}
                        disabled={busy}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                        aria-label="Delete component"
                    >
                        <Trash2 size={13} />
                    </button>
                </div>
            </div>

            {editing && (
                <EditComponentRow
                    plan={plan}
                    component={component}
                    onSaved={onSaved}
                />
            )}
        </li>
    );
}

interface EditComponentRowProps {
    plan: FinancialPlan;
    component: FinancialPlanComponentView;
    onSaved: () => Promise<void> | void;
}

function EditComponentRow({
    plan,
    component,
    onSaved,
}: EditComponentRowProps) {
    const roles = allowedRolesFor(
        plan.planType,
        component.componentType
    );

    const [role, setRole] = useState<PlanComponentRole>(
        component.role
    );
    const [label, setLabel] = useState(
        component.label ?? ""
    );
    const [targetAmount, setTargetAmount] = useState(
        component.targetAmount !== null
            ? String(component.targetAmount)
            : ""
    );
    const [notes, setNotes] = useState(
        component.notes ?? ""
    );
    const [saving, setSaving] = useState(false);

    const targetsAllowed = componentTargetsAllowed(
        plan.planType
    );

    async function save() {
        setSaving(true);

        try {
            await new FinancialPlanComponentService().update(
                {
                    id: component.id,
                    role,
                    label: label.trim() || null,
                    targetAmount:
                        targetsAllowed &&
                        targetAmount.trim() !== ""
                            ? Number(targetAmount)
                            : null,
                    notes: notes.trim() || null,
                    isActive: component.isActive,
                }
            );

            toast.success("Component updated.");
            await onSaved();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update component."
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-[11px] text-slate-400">
                The source (
                {component.sourceName ??
                    "unavailable"}
                ) and component type cannot be changed —
                remove and re-add to re-point.
            </p>

            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-600">
                        Role
                    </label>

                    <select
                        value={role}
                        onChange={event =>
                            setRole(
                                event.target
                                    .value as PlanComponentRole
                            )
                        }
                        disabled={
                            saving || roles.length <= 1
                        }
                        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                    >
                        {roles.map(value => (
                            <option
                                key={value}
                                value={value}
                            >
                                {getPlanComponentRoleLabel(
                                    value
                                )}
                            </option>
                        ))}
                    </select>
                </div>

                {targetsAllowed && (
                    <div className="space-y-1">
                        <label className="text-[11px] font-medium text-slate-600">
                            Component Target
                        </label>

                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={targetAmount}
                            onChange={event =>
                                setTargetAmount(
                                    event.target.value
                                )
                            }
                            disabled={saving}
                            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                        />
                    </div>
                )}
            </div>

            <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-600">
                    Label
                </label>

                <input
                    value={label}
                    onChange={event =>
                        setLabel(event.target.value)
                    }
                    disabled={saving}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                />
            </div>

            <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-600">
                    Notes
                </label>

                <textarea
                    value={notes}
                    onChange={event =>
                        setNotes(event.target.value)
                    }
                    rows={2}
                    disabled={saving}
                    className="w-full resize-none rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                />
            </div>

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="h-8 rounded-lg bg-slate-900 px-4 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                    {saving ? "Saving..." : "Save"}
                </button>
            </div>
        </div>
    );
}
