import { useState } from "react";
import { Pause, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { usePaymentTypes } from "../hooks";
import { PaymentTypeService, paymentTypeCodeFromLabel } from "../services";
import type { PaymentType } from "../types";

import {
    addPaymentType,
    deleteBlockerFor,
    deletePaymentType,
    newLabelAfter,
    reactivatePaymentType,
    renamePaymentType,
    togglePaymentTypeActive,
    type PaymentTypeActionResult,
} from "./paymentTypeActions";

// ---------------------------------------------------------------------
// Payment Types page (sidebar -> Payment Type): the one place the Payment
// Type master list is managed. List, add, rename, activate/deactivate and
// delete. Delete is only for an unused, user-added type - a type any
// record stores is deactivated instead (hidden from new selections,
// still shown where already used).
// ---------------------------------------------------------------------

// FinWea's own button look (as on Categories / Accounts: dark primary,
// white bordered secondary), applied to the shared Button component.
// Explicit colours are needed because the shadcn theme variables behind
// the Button's default/outline variants are not loaded in FinWea.
const PRIMARY_BUTTON =
    "h-10 gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 hover:shadow-md " +
    // Disabled (no valid name yet): clearly muted, not-allowed cursor, no
    // hover - overrides the base button's 50%-opacity, no-pointer look.
    "disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:hover:bg-slate-200 disabled:hover:shadow-none";
const ROW_PRIMARY_BUTTON =
    "h-8 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800";
const ROW_SECONDARY_BUTTON =
    "h-8 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50";
// Compact icon-only row actions; the action's name is its tooltip
// (title) and accessible name (aria-label).
const ICON_BUTTON =
    "size-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-300";
const ICON_BUTTON_DANGER =
    "size-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-200";

// A name the service would accept: it must contain a letter or digit.
export function canAddPaymentType(label: string): boolean {
    return paymentTypeCodeFromLabel(label) !== "";
}

export interface PaymentTypeManagerViewProps {
    paymentTypes: readonly PaymentType[];
    loading: boolean;
    loadError: string | null;
    newLabel: string;
    editingId: string | null;
    editingLabel: string;
    busy: boolean;
    formError: string | null;
    // An inactive type matching the name just added - offered for
    // reactivation instead of creating a second record.
    reactivateCandidate: PaymentType | null;
    // The row just added - scrolled into view and highlighted.
    highlightId?: string | null;
    // The type awaiting Delete confirmation (always an unused one).
    pendingDelete?: PaymentType | null;
    deleteError?: string | null;
    onReactivateCandidate: (paymentType: PaymentType) => void;
    onNewLabelChange: (value: string) => void;
    onAdd: () => void;
    onStartRename: (paymentType: PaymentType) => void;
    onEditingLabelChange: (value: string) => void;
    onSaveRename: () => void;
    onCancelRename: () => void;
    onToggleActive: (paymentType: PaymentType) => void;
    onRequestDelete?: (paymentType: PaymentType) => void;
    onConfirmDelete?: () => void;
    onCancelDelete?: () => void;
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
    reactivateCandidate,
    highlightId = null,
    pendingDelete = null,
    deleteError = null,
    onReactivateCandidate,
    onNewLabelChange,
    onAdd,
    onStartRename,
    onEditingLabelChange,
    onSaveRename,
    onCancelRename,
    onToggleActive,
    onRequestDelete = () => {},
    onConfirmDelete = () => {},
    onCancelDelete = () => {},
}: PaymentTypeManagerViewProps) {
    const activeCount = paymentTypes.filter(type => type.isActive).length;
    const canAdd = !busy && canAddPaymentType(newLabel);

    return (
        <div className="space-y-4">
            <p className="text-sm leading-5 text-slate-500">
                The master list of payment types offered in Import Preview,
                Import Rules, Add/Edit Transaction and Loan EMI payments.
                Inactive types are not offered for new selections;
                transactions that already use them keep their value. Only
                an unused type you added can be deleted.
            </p>

            {paymentTypes.length > 0 && (
                <p className="text-sm text-slate-600" data-testid="payment-type-counts">
                    <span className="font-semibold text-slate-900">{paymentTypes.length}</span> payment types
                    {" · "}
                    <span className="font-semibold text-emerald-700">{activeCount}</span> active
                    {" · "}
                    <span className="font-semibold text-slate-500">{paymentTypes.length - activeCount}</span> inactive
                </p>
            )}

            {/* Add is a direct click handler (like every row action), not a
                form submission; Enter in the name field does the same. */}
            <div className="flex items-start gap-3">
                <Input
                    aria-label="New payment type"
                    placeholder="Payment type name, e.g. Google Pay"
                    value={newLabel}
                    onChange={event => onNewLabelChange(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === "Enter") {
                            event.preventDefault();

                            if (canAdd) {
                                onAdd();
                            }
                        }
                    }}
                    disabled={busy}
                    className="h-10 max-w-xs rounded-xl"
                />

                <Button
                    type="button"
                    data-testid="add-payment-type"
                    onClick={() => {
                        if (canAdd) {
                            onAdd();
                        }
                    }}
                    disabled={!canAdd}
                    className={PRIMARY_BUTTON}
                >
                    <Plus size={16} />
                    {busy ? "Saving..." : "Add Payment Type"}
                </Button>
            </div>

            {formError && (
                <div
                    className="flex flex-wrap items-center gap-3"
                    role="alert"
                >
                    <p className="text-sm text-red-600">{formError}</p>

                    {reactivateCandidate && (
                        <Button
                            type="button"
                            onClick={() => onReactivateCandidate(reactivateCandidate)}
                            disabled={busy}
                            className={ROW_PRIMARY_BUTTON}
                        >
                            Reactivate "{reactivateCandidate.label}"
                        </Button>
                    )}
                </div>
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
                                const highlighted = highlightId === paymentType.id;
                                const rowLocked = busy || editingId !== null;

                                return (
                                    <tr
                                        key={paymentType.id}
                                        data-payment-type-id={paymentType.id}
                                        ref={element => {
                                            if (element && highlighted) {
                                                element.scrollIntoView({ block: "nearest", behavior: "smooth" });
                                            }
                                        }}
                                        className={
                                            highlighted
                                                ? "bg-emerald-50 transition-colors"
                                                : paymentType.isActive
                                                    ? "transition-colors"
                                                    : "bg-slate-50/60 transition-colors"
                                        }
                                    >
                                        <td className="px-4 py-2.5 font-medium text-slate-900">
                                            {editing ? (
                                                <Input
                                                    aria-label={`Rename ${paymentType.label}`}
                                                    // Ready to type the new name immediately.
                                                    autoFocus
                                                    onFocus={event => event.currentTarget.select()}
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
                                                            type="button"
                                                            onClick={onSaveRename}
                                                            disabled={busy || editingLabel.trim() === ""}
                                                            className={ROW_PRIMARY_BUTTON}
                                                        >
                                                            Save
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            onClick={onCancelRename}
                                                            disabled={busy}
                                                            className={ROW_SECONDARY_BUTTON}
                                                        >
                                                            Cancel
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <IconAction
                                                            label={`Rename ${paymentType.label}`}
                                                            tooltip="Rename"
                                                            onClick={() => onStartRename(paymentType)}
                                                            disabled={rowLocked}
                                                        >
                                                            <Pencil size={15} />
                                                        </IconAction>

                                                        {paymentType.isActive ? (
                                                            <IconAction
                                                                label={`Deactivate ${paymentType.label}`}
                                                                tooltip="Deactivate"
                                                                onClick={() => onToggleActive(paymentType)}
                                                                disabled={rowLocked}
                                                            >
                                                                <Pause size={15} />
                                                            </IconAction>
                                                        ) : (
                                                            <IconAction
                                                                label={`Activate ${paymentType.label}`}
                                                                tooltip="Activate"
                                                                onClick={() => onToggleActive(paymentType)}
                                                                disabled={rowLocked}
                                                            >
                                                                <RotateCcw size={15} />
                                                            </IconAction>
                                                        )}

                                                        <IconAction
                                                            label={`Delete ${paymentType.label}`}
                                                            tooltip="Delete"
                                                            onClick={() => onRequestDelete(paymentType)}
                                                            disabled={rowLocked}
                                                            danger
                                                        >
                                                            <Trash2 size={15} />
                                                        </IconAction>
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

            <AlertDialog
                open={pendingDelete !== null}
                onOpenChange={next => {
                    if (!next && !busy) {
                        onCancelDelete();
                    }
                }}
            >
                <AlertDialogContent className="data-[size=default]:sm:max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Payment Type?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {pendingDelete &&
                                `Are you sure you want to permanently delete "${pendingDelete.label}"? This action cannot be undone.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    {deleteError && (
                        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                            {deleteError}
                        </p>
                    )}

                    <AlertDialogFooter>
                        <AlertDialogAction
                            variant="outline"
                            disabled={busy}
                            onClick={onCancelDelete}
                            className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                        >
                            Cancel
                        </AlertDialogAction>
                        <AlertDialogAction
                            disabled={busy}
                            onClick={onConfirmDelete}
                            className="h-9 rounded-lg bg-red-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-red-700"
                        >
                            {busy ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

// A compact icon-only row action: tooltip via title, name via aria-label,
// a real <button> (Tab/Enter/Space work), visible hover and focus ring.
function IconAction({
    label,
    tooltip,
    onClick,
    disabled,
    danger = false,
    children,
}: {
    label: string;
    tooltip: string;
    onClick: () => void;
    disabled: boolean;
    danger?: boolean;
    children: React.ReactNode;
}) {
    return (
        <Button
            type="button"
            aria-label={label}
            title={tooltip}
            onClick={onClick}
            disabled={disabled}
            className={danger ? ICON_BUTTON_DANGER : ICON_BUTTON}
        >
            {children}
        </Button>
    );
}

export function PaymentTypeManager() {
    const { paymentTypes, loading, error } = usePaymentTypes();

    const [newLabel, setNewLabel] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingLabel, setEditingLabel] = useState("");
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [reactivateCandidate, setReactivateCandidate] =
        useState<PaymentType | null>(null);
    const [highlightId, setHighlightId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<PaymentType | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Applies an action's result: busy while it runs (which also blocks a
    // second submission), then a toast on success or the message (and any
    // Reactivate offer) on failure.
    async function run(
        perform: () => Promise<PaymentTypeActionResult>
    ): Promise<PaymentTypeActionResult> {
        setBusy(true);
        setFormError(null);
        setReactivateCandidate(null);

        try {
            const result = await perform();

            if (result.ok) {
                toast.success(result.success);
            } else {
                setFormError(result.error);
                setReactivateCandidate(result.reactivateCandidate);
            }

            return result;
        } finally {
            setBusy(false);
        }
    }

    async function handleAdd() {
        if (busy) {
            return;
        }

        const label = newLabel;
        const result = await run(() =>
            addPaymentType(new PaymentTypeService(), label)
        );

        setNewLabel(newLabelAfter(result, label));
        setHighlightId(result.createdId);
    }

    async function handleSaveRename() {
        if (!editingId) {
            return;
        }

        const id = editingId;
        const label = editingLabel;

        if ((await run(() => renamePaymentType(new PaymentTypeService(), id, label))).ok) {
            setEditingId(null);
        }
    }

    async function handleToggleActive(paymentType: PaymentType) {
        await run(() =>
            togglePaymentTypeActive(new PaymentTypeService(), paymentType)
        );
    }

    async function handleReactivateCandidate(paymentType: PaymentType) {
        const label = newLabel;
        const result = await run(() =>
            reactivatePaymentType(new PaymentTypeService(), paymentType)
        );

        setNewLabel(newLabelAfter(result, label));

        if (result.ok) {
            setHighlightId(paymentType.id);
        }
    }

    // Only an unused, user-added type reaches the confirmation; any other
    // gets the "in use - deactivate instead" message.
    async function handleRequestDelete(paymentType: PaymentType) {
        setBusy(true);
        setFormError(null);
        setReactivateCandidate(null);

        try {
            const blocker = await deleteBlockerFor(
                new PaymentTypeService(),
                paymentType
            );

            if (blocker) {
                setFormError(blocker);
                toast.error(blocker);
            } else {
                setDeleteError(null);
                setPendingDelete(paymentType);
            }
        } finally {
            setBusy(false);
        }
    }

    async function handleConfirmDelete() {
        if (!pendingDelete) {
            return;
        }

        const target = pendingDelete;
        setBusy(true);

        try {
            const result = await deletePaymentType(new PaymentTypeService(), target);

            if (result.ok) {
                toast.success(result.success);
                setPendingDelete(null);
                setHighlightId(null);
            } else {
                setDeleteError(result.error);
            }
        } finally {
            setBusy(false);
        }
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
            reactivateCandidate={reactivateCandidate}
            highlightId={highlightId}
            pendingDelete={pendingDelete}
            deleteError={deleteError}
            onReactivateCandidate={paymentType =>
                void handleReactivateCandidate(paymentType)
            }
            onNewLabelChange={value => {
                setNewLabel(value);
                setReactivateCandidate(null);
            }}
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
            onRequestDelete={paymentType => void handleRequestDelete(paymentType)}
            onConfirmDelete={() => void handleConfirmDelete()}
            onCancelDelete={() => {
                setPendingDelete(null);
                setDeleteError(null);
            }}
        />
    );
}
