import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getErrorMessage } from "@/core/errors";

import { notifyPaymentTypesChanged, usePaymentTypes } from "../hooks";
import { PaymentTypeService } from "../services";
import type { PaymentType } from "../types";

// ---------------------------------------------------------------------
// Settings -> Payment Types: the one place the Payment Type master list is
// managed. List, add, rename, activate/deactivate. There is no delete -
// existing transactions may store any code, so a type is deactivated
// instead (hidden from new selections, still shown where already used).
// ---------------------------------------------------------------------

export interface PaymentTypeManagerViewProps {
    paymentTypes: readonly PaymentType[];
    loading: boolean;
    loadError: string | null;
    newLabel: string;
    editingId: string | null;
    editingLabel: string;
    busy: boolean;
    formError: string | null;
    onNewLabelChange: (value: string) => void;
    onAdd: () => void;
    onStartRename: (paymentType: PaymentType) => void;
    onEditingLabelChange: (value: string) => void;
    onSaveRename: () => void;
    onCancelRename: () => void;
    onToggleActive: (paymentType: PaymentType) => void;
}

export function PaymentTypeManagerView({
    paymentTypes,
    loading,
    loadError,
    newLabel,
    editingId,
    editingLabel,
    busy,
    formError,
    onNewLabelChange,
    onAdd,
    onStartRename,
    onEditingLabelChange,
    onSaveRename,
    onCancelRename,
    onToggleActive,
}: PaymentTypeManagerViewProps) {
    return (
        <div className="space-y-4">
            <p className="text-sm leading-5 text-slate-500">
                The payment types offered in Import Preview, Import Rules,
                Add/Edit Transaction and Loan EMI payments. Inactive types
                are not offered for new selections; transactions that
                already use them keep their value.
            </p>

            <form
                className="flex items-start gap-3"
                onSubmit={event => {
                    event.preventDefault();
                    onAdd();
                }}
            >
                <Input
                    aria-label="New payment type"
                    placeholder="e.g. Google Pay"
                    value={newLabel}
                    onChange={event => onNewLabelChange(event.target.value)}
                    disabled={busy}
                    className="max-w-xs"
                />

                <Button
                    type="submit"
                    disabled={busy || newLabel.trim() === ""}
                >
                    Add Payment Type
                </Button>
            </form>

            {formError && (
                <p className="text-sm text-red-600">{formError}</p>
            )}

            {loadError ? (
                <p className="text-sm text-red-600">{loadError}</p>
            ) : loading && paymentTypes.length === 0 ? (
                <p className="text-sm text-slate-500">Loading payment types...</p>
            ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="px-4 py-2.5">Name</th>
                                <th className="px-4 py-2.5">Code</th>
                                <th className="px-4 py-2.5">Status</th>
                                <th className="px-4 py-2.5 text-right">Actions</th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-100">
                            {paymentTypes.map(paymentType => {
                                const editing = editingId === paymentType.id;

                                return (
                                    <tr
                                        key={paymentType.id}
                                        className={paymentType.isActive ? "" : "bg-slate-50/60"}
                                    >
                                        <td className="px-4 py-2.5 font-medium text-slate-900">
                                            {editing ? (
                                                <Input
                                                    aria-label={`Rename ${paymentType.label}`}
                                                    value={editingLabel}
                                                    onChange={event =>
                                                        onEditingLabelChange(event.target.value)
                                                    }
                                                    onKeyDown={event => {
                                                        if (event.key === "Enter") {
                                                            event.preventDefault();
                                                            onSaveRename();
                                                        } else if (event.key === "Escape") {
                                                            onCancelRename();
                                                        }
                                                    }}
                                                    disabled={busy}
                                                    className="h-8 max-w-xs"
                                                />
                                            ) : (
                                                paymentType.label
                                            )}
                                        </td>

                                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                                            {paymentType.code}
                                        </td>

                                        <td className="px-4 py-2.5">
                                            <span
                                                className={
                                                    paymentType.isActive
                                                        ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                                                        : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
                                                }
                                            >
                                                {paymentType.isActive ? "Active" : "Inactive"}
                                            </span>
                                        </td>

                                        <td className="px-4 py-2.5">
                                            <div className="flex justify-end gap-2">
                                                {editing ? (
                                                    <>
                                                        <Button
                                                            size="sm"
                                                            onClick={onSaveRename}
                                                            disabled={busy || editingLabel.trim() === ""}
                                                        >
                                                            Save
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={onCancelRename}
                                                            disabled={busy}
                                                        >
                                                            Cancel
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => onStartRename(paymentType)}
                                                            disabled={busy || editingId !== null}
                                                        >
                                                            Rename
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => onToggleActive(paymentType)}
                                                            disabled={busy || editingId !== null}
                                                        >
                                                            {paymentType.isActive ? "Deactivate" : "Activate"}
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export function PaymentTypeManager() {
    const { paymentTypes, loading, error } = usePaymentTypes();

    const [newLabel, setNewLabel] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingLabel, setEditingLabel] = useState("");
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    async function run(
        action: () => Promise<void>,
        success: string,
        fallback: string
    ): Promise<boolean> {
        try {
            setBusy(true);
            setFormError(null);

            await action();

            notifyPaymentTypesChanged();
            toast.success(success);

            return true;
        } catch (err) {
            setFormError(getErrorMessage(err, fallback));

            return false;
        } finally {
            setBusy(false);
        }
    }

    async function handleAdd() {
        const label = newLabel;

        if (
            await run(
                async () => {
                    await new PaymentTypeService().create({ label });
                },
                "Payment type added.",
                "Unable to add the payment type."
            )
        ) {
            setNewLabel("");
        }
    }

    async function handleSaveRename() {
        if (!editingId) {
            return;
        }

        const id = editingId;
        const label = editingLabel;

        if (
            await run(
                async () => {
                    await new PaymentTypeService().update({ id, label });
                },
                "Payment type renamed.",
                "Unable to rename the payment type."
            )
        ) {
            setEditingId(null);
        }
    }

    async function handleToggleActive(paymentType: PaymentType) {
        await run(
            async () => {
                await new PaymentTypeService().update({
                    id: paymentType.id,
                    isActive: !paymentType.isActive,
                });
            },
            paymentType.isActive
                ? `"${paymentType.label}" deactivated.`
                : `"${paymentType.label}" activated.`,
            "Unable to update the payment type."
        );
    }

    return (
        <PaymentTypeManagerView
            paymentTypes={paymentTypes}
            loading={loading}
            loadError={error}
            newLabel={newLabel}
            editingId={editingId}
            editingLabel={editingLabel}
            busy={busy}
            formError={formError}
            onNewLabelChange={setNewLabel}
            onAdd={() => void handleAdd()}
            onStartRename={paymentType => {
                setFormError(null);
                setEditingId(paymentType.id);
                setEditingLabel(paymentType.label);
            }}
            onEditingLabelChange={setEditingLabel}
            onSaveRename={() => void handleSaveRename()}
            onCancelRename={() => {
                setFormError(null);
                setEditingId(null);
            }}
            onToggleActive={paymentType => void handleToggleActive(paymentType)}
        />
    );
}
