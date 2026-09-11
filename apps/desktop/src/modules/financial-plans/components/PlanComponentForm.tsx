import {
    useEffect,
    useMemo,
    useState,
    type FormEvent,
} from "react";
import { toast } from "sonner";

import { FinancialPlanComponentService } from "../services";
import {
    allowedComponentTypesFor,
    allowedRolesFor,
    componentTargetsAllowed,
    getPlanComponentComboLabel,
    getPlanComponentRoleLabel,
    getPlanComponentTypeLabel,
    PLAN_COMPONENT_CATALOG,
} from "../constants";
import { usePlanComponentSources } from "../hooks";
import type {
    FinancialPlan,
    PlanComponentRole,
    PlanComponentType,
} from "../types";

const FIELD_CLASS =
    "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50";

const LABEL_CLASS =
    "text-xs font-medium text-slate-600";

export interface PlanComponentFormProps {
    plan: FinancialPlan;
    onCreated: () => Promise<void> | void;
    onCancel: () => void;
}

export function PlanComponentForm({
    plan,
    onCreated,
    onCancel,
}: PlanComponentFormProps) {
    const sources = usePlanComponentSources();

    const componentTypes = useMemo(
        () => allowedComponentTypesFor(plan.planType),
        [plan.planType]
    );

    const [componentType, setComponentType] =
        useState<PlanComponentType>(
            componentTypes[0] ?? "ACCOUNT"
        );

    const roles = useMemo(
        () =>
            allowedRolesFor(
                plan.planType,
                componentType
            ),
        [plan.planType, componentType]
    );

    const [role, setRole] = useState<PlanComponentRole>(
        roles[0] ?? "ASSET"
    );

    const [sourceId, setSourceId] = useState("");
    const [label, setLabel] = useState("");
    const [targetAmount, setTargetAmount] =
        useState("");
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);

    // Keep role valid whenever the component type changes.
    useEffect(() => {
        if (!roles.includes(role)) {
            setRole(roles[0] ?? "ASSET");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [componentType]);

    const options = useMemo(
        () =>
            sources.sourceOptionsFor(
                componentType,
                role,
                plan.currencyId
            ),
        [sources, componentType, role, plan.currencyId]
    );

    // Reset the chosen source when the option set changes.
    useEffect(() => {
        setSourceId(prev =>
            options.some(option => option.id === prev)
                ? prev
                : ""
        );
    }, [options]);

    const targetsAllowed = componentTargetsAllowed(
        plan.planType
    );

    const comboMeta = PLAN_COMPONENT_CATALOG.find(
        entry =>
            entry.componentType === componentType &&
            entry.role === role
    );

    async function handleSubmit(
        event: FormEvent
    ) {
        event.preventDefault();

        if (!sourceId) {
            toast.error(
                "Select a source for this component."
            );
            return;
        }

        setSaving(true);

        try {
            await new FinancialPlanComponentService().create(
                {
                    planId: plan.id,
                    componentType,
                    role,
                    sourceId,
                    label: label.trim() || null,
                    targetAmount:
                        targetsAllowed &&
                        targetAmount.trim() !== ""
                            ? Number(targetAmount)
                            : null,
                    notes: notes.trim() || null,
                }
            );

            toast.success("Component added.");
            await onCreated();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to add component."
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4"
        >
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>
                        Component Type
                    </label>

                    <select
                        value={componentType}
                        onChange={event =>
                            setComponentType(
                                event.target
                                    .value as PlanComponentType
                            )
                        }
                        disabled={saving}
                        className={FIELD_CLASS}
                    >
                        {componentTypes.map(type => (
                            <option
                                key={type}
                                value={type}
                            >
                                {getPlanComponentTypeLabel(
                                    type
                                )}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>
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
                        className={FIELD_CLASS}
                    >
                        {roles.map(value => (
                            <option
                                key={value}
                                value={value}
                            >
                                {getPlanComponentComboLabel(
                                    componentType,
                                    value
                                )}{" "}
                                (
                                {getPlanComponentRoleLabel(
                                    value
                                )}
                                )
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {comboMeta && (
                <p className="text-xs text-slate-400">
                    {comboMeta.description}
                </p>
            )}

            <div className="space-y-1.5">
                <label className={LABEL_CLASS}>
                    Source
                </label>

                <select
                    value={sourceId}
                    onChange={event =>
                        setSourceId(event.target.value)
                    }
                    disabled={
                        saving ||
                        sources.loading ||
                        options.length === 0
                    }
                    className={FIELD_CLASS}
                >
                    <option value="">
                        {sources.loading
                            ? "Loading sources..."
                            : options.length === 0
                              ? "No matching sources in this currency"
                              : "Select a source"}
                    </option>

                    {options.map(option => (
                        <option
                            key={option.id}
                            value={option.id}
                        >
                            {option.name}
                            {option.detail
                                ? ` — ${option.detail}`
                                : ""}
                        </option>
                    ))}
                </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>
                        Label (optional)
                    </label>

                    <input
                        value={label}
                        onChange={event =>
                            setLabel(
                                event.target.value
                            )
                        }
                        disabled={saving}
                        placeholder="Defaults to the source name"
                        className={FIELD_CLASS}
                    />
                </div>

                {targetsAllowed && (
                    <div className="space-y-1.5">
                        <label
                            className={LABEL_CLASS}
                        >
                            Component Target (optional)
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
                            className={FIELD_CLASS}
                        />
                    </div>
                )}
            </div>

            <div className="space-y-1.5">
                <label className={LABEL_CLASS}>
                    Notes (optional)
                </label>

                <textarea
                    value={notes}
                    onChange={event =>
                        setNotes(event.target.value)
                    }
                    rows={2}
                    disabled={saving}
                    className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                />
            </div>

            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={saving}
                    className="h-8 rounded-lg border border-slate-300 bg-white px-4 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                    Cancel
                </button>

                <button
                    type="submit"
                    disabled={saving || !sourceId}
                    className="h-8 rounded-lg bg-slate-900 px-4 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                    {saving ? "Adding..." : "Add Component"}
                </button>
            </div>
        </form>
    );
}
