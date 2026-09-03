import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";

import { LoanForm } from "./LoanForm";
import { LoanService } from "../services";
import type { Loan } from "../types";
import type { LoanFormValues } from "../validation";

export interface EditLoanDialogProps {
    loan: Loan | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?(): void | Promise<void>;
}

export function EditLoanDialog({
    loan,
    open,
    onOpenChange,
    onSuccess,
}: EditLoanDialogProps) {
    const [loading, setLoading] = useState(false);
    const [lenderName, setLenderName] = useState("");

    useEffect(() => {
        let mounted = true;

        async function loadLender() {
            if (!loan?.lenderInstitutionId) {
                setLenderName("");
                return;
            }

            try {
                const repository = new InstitutionRepository();
                const institution = await repository.getById(
                    loan.lenderInstitutionId
                );

                if (mounted) {
                    setLenderName(institution?.name ?? "");
                }
            } catch (error) {
                console.error("Failed to load lender:", error);

                if (mounted) {
                    setLenderName("");
                }
            }
        }

        void loadLender();

        return () => {
            mounted = false;
        };
    }, [loan]);

    useEffect(() => {
        if (!open) {
            setLoading(false);
        }
    }, [open]);

    if (!loan) {
        return null;
    }

    async function handleSubmit(values: LoanFormValues) {
        if (!loan) {
            return;
        }

        const currentLoan = loan;

        try {
            setLoading(true);

            const service = new LoanService();

            await service.update({
                id: currentLoan.id,
                name: values.name,
                loanType: values.loanType,
                lenderInstitutionName:
                    values.lenderInstitutionName || undefined,
                accountId: values.accountId || undefined,
                currencyId: values.currencyId,
                principalAmount: values.principalAmount,
                interestRate: values.interestRate,
                interestType: values.interestType,
                tenureMonths: values.tenureMonths,
                emiAmount: values.emiAmount,
                paidInstallments: values.paidInstallments,
                startDate: values.startDate,
                maturityDate: values.maturityDate || undefined,
                status: values.status,
                notes: values.notes || undefined,
            });

            await onSuccess?.();

            toast.success("Loan updated successfully.");
            onOpenChange(false);
        } catch (error) {
            console.error("Failed to update loan:", error);

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to update loan."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={openState => {
                if (!loading) {
                    onOpenChange(openState);
                }
            }}
        >
            <DialogContent
                showCloseButton={!loading}
                className="
                    max-h-[calc(100vh-32px)]
                    w-[900px]
                    max-w-[calc(100vw-32px)]
                    overflow-y-auto
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-4 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Edit Loan
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Update the basic loan details.
                    </DialogDescription>
                </DialogHeader>

                <div className="border-t border-slate-100 px-7 py-5">
                    <LoanForm
                        editMode
                        defaultValues={{
                            name: loan.name,
                            loanType: loan.loanType,
                            lenderInstitutionName: lenderName,
                            accountId: loan.accountId ?? "",
                            currencyId: loan.currencyId,
                            principalAmount: loan.principalAmount,
                            interestRate: loan.interestRate,
                            interestType: loan.interestType,
                            tenureMonths:
                                loan.tenureMonths ?? undefined,
                            emiAmount:
                                loan.emiAmount ?? undefined,
                            paidInstallments:
                                loan.paidInstallments ?? 0,
                            startDate: loan.startDate,
                            maturityDate:
                                loan.maturityDate ?? "",
                            status: loan.status,
                            notes: loan.notes ?? "",
                        }}
                        loading={loading}
                        submitLabel="Save Changes"
                        onCancel={() => onOpenChange(false)}
                        onSubmit={handleSubmit}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
