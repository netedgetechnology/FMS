import { useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { FormField } from "@/components/forms";

import { useAccounts } from "@/modules/accounts/hooks";
import { AccountType, type Account } from "@/modules/accounts/types";

import {
    isLockedResolution,
    resolveCategoryTransactionType,
    useCategories,
    useCategoryContextMappings,
} from "@/modules/categories";
import { transferDirectionForType } from "@/core/accounting/transferClassification";

import {
    paymentTypeLabel,
    paymentTypeOptionsFor,
    usePaymentTypes,
} from "@/modules/payment-types";

import {
    TransactionFormInput,
    TransactionFormValues,
    transactionSchema,
} from "../validation";

import {
    derivationSideFor,
    directionChecks,
    finalTyping,
    initialDebitCreditSide,
    sideOf,
    typeForSelectedCategory,
    type DebitCreditSide,
} from "./transactionFormTyping";

export interface TransactionFormProps {
    defaultValues?: Partial<TransactionFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onCancel?(): void;
    onSubmit(values: TransactionFormValues): void | Promise<void>;
    /**
     * Edit only: the bank statement's Debit/Credit side of an imported
     * transaction (TransactionService.getStatementSide). A Transfer's
     * direction is derived from it. Optional - it may arrive after the
     * form has opened.
     */
    statementSide?: "income" | "expense" | null;
    /**
     * Edit only: the overdraft movement the transaction is linked as
     * (DRAWDOWN / REPAYMENT / INTEREST_CHARGE), if any - a conflicting
     * direction is warned about.
     */
    linkedMovementKind?: string | null;
    /**
     * Edit only: the Debit/Credit side the transaction had when opened -
     * a save that changes it is always shown, and blocked when the bank
     * statement contradicts the new side.
     */
    originalSide?: DebitCreditSide | null;
}

// Last 4 digits of the card number, masked, for the Card Reference picker.
function maskedCardTail(account: Account): string {
    const tail = (account.accountNumber ?? "")
        .replace(/\D/g, "")
        .slice(-4);

    return tail ? `••${tail}` : "";
}

// `new Date().toISOString().slice(0, 10)` reads the UTC calendar date,
// which is a day behind local midnight for any positive UTC offset
// (e.g. IST) - this reads the actual local Y/M/D fields instead, the
// same technique DashboardService's toLocalISODate uses.
export function todayLocalDate(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function creditCardOptionLabel(account: Account): string {
    return [
        account.name,
        account.institutionName,
        maskedCardTail(account),
    ]
        .filter(Boolean)
        .join(" — ");
}

// The Card Reference picker belongs to a credit-card payment: CREDIT_CARD
// (the master list's "Credit Card") or CARD, the legacy code the form
// stored for it before the Payment Type master list existed.
export function isCreditCardPaymentType(
    code: string | null | undefined
): boolean {
    return code === "CREDIT_CARD" || code === "CARD";
}

function Section({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="space-y-2.5">
            <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-slate-900">
                    {title}
                </h3>

                <div className="h-px flex-1 bg-slate-100" />
            </div>

            {children}
        </section>
    );
}

export function TransactionForm({
    defaultValues,
    loading = false,
    submitLabel = "Save",
    onCancel,
    onSubmit,
    statementSide = null,
    linkedMovementKind = null,
    originalSide = null,
}: TransactionFormProps) {
    const { accounts } = useAccounts();
    const { categories } = useCategories();
    const { mappings } = useCategoryContextMappings();
    const {
        paymentTypes,
        activeOptions: activePaymentTypes,
    } = usePaymentTypes();

    const {
        register,
        control,
        handleSubmit,
        watch,
        setValue,
        getValues,
        formState: { errors },
    } = useForm<TransactionFormInput, unknown, TransactionFormValues>({
        resolver: zodResolver(transactionSchema),
        defaultValues: {
            accountId: "",
            categoryId: "",
            subcategoryId: "",
            payee: "",
            description: "",
            type: "expense",
            transferDirection: null,
            amount: 0,
            transactionDate: todayLocalDate(),
            referenceNumber: "",
            notes: "",
            tags: "",
            status: "CLEARED",
            paymentMethod: null,
            upiReference: "",
            bankTransactionReference: "",
            cardReference: "",
            ...defaultValues,
        },
    });

    const activeAccounts = accounts.filter(
        account => account.isActive
    );

    const activeCategories = categories.filter(
        category => category.isActive
    );

    const creditCardAccounts = activeAccounts.filter(
        account => account.type === AccountType.CREDIT_CARD
    );

    const paymentMethod = watch("paymentMethod");

    // Active master-list types, plus the transaction's own stored value
    // when that type is now inactive - kept selectable so editing never
    // erases it.
    const paymentMethodOptions = paymentTypeOptionsFor(
        activePaymentTypes,
        paymentTypes,
        defaultValues?.paymentMethod
    );
    const accountId = watch("accountId");
    const categoryId = watch("categoryId");
    const transactionType = watch("type");

    const selectedAccountForType = activeAccounts.find(
        account => account.id === accountId
    );

    const typeResolution = resolveCategoryTransactionType({
        categoryId: categoryId || null,
        accountId: accountId || null,
        businessEntityId: selectedAccountForType?.businessEntityId ?? null,
        mappings,
        categories: activeCategories,
    });

    // Only an account- or business-entity-specific mapping locks the
    // Type field - the category's own default type (source "default")
    // stays an editable suggestion, see resolveCategoryTransactionType.
    const isTypeLocked = isLockedResolution(typeResolution);

    // Tracks the account/category pair from the previous render so the
    // auto-set effect below only reacts to the user actually changing
    // one of them - never to the initial mount, which would otherwise
    // overwrite an edited transaction's existing type as soon as the
    // dialog opens.
    const previousContextRef = useRef<{
        accountId: string;
        categoryId: string;
    } | null>(null);

    // A transfer's direction is never entered. When it has to be derived
    // (the Type becomes Transfer, or a category is chosen), the side it
    // comes from is, in order (derivationSideFor):
    //   1. Income / Expense picked BY HAND in the Type field;
    //   2. the selected Transfer category's configured direction
    //      (categories.transfer_direction - e.g. In for a drawdown
    //      category, Out for a repayment category);
    //   3. the bank statement's side, for an imported transaction still
    //      on its statement's account;
    //   4. the Income / Expense the form shows or last showed.
    // Read at render time, so it never depends on when the statement side
    // arrives. An Income/Expense transaction never carries a transfer
    // direction. An edited transfer keeps the direction it was saved with
    // until a category with a direction is chosen.
    const selectedCategoryForType = activeCategories.find(
        category => category.id === categoryId
    );
    const categoryDirection =
        selectedCategoryForType?.categoryType === "TRANSFER"
            ? selectedCategoryForType.transferDirection ?? null
            : null;
    const manualSideRef = useRef<DebitCreditSide | null>(null);
    const shownSideRef = useRef<DebitCreditSide | null>(
        initialDebitCreditSide(defaultValues?.type, null)
    );
    const derivationSide = (): DebitCreditSide | null =>
        derivationSideFor({
            manualSide: manualSideRef.current,
            categoryDirection,
            statementSide,
            shownSide: shownSideRef.current,
        });

    // The Type at the previous render - so opening the form (or a
    // re-render) is never mistaken for a change of Type.
    const previousTypeRef = useRef(transactionType);
    // Set while the category effect below changes the Type: that is not
    // the user picking a side by hand.
    const typeSetByCategoryRef = useRef(false);
    // Whether the current transfer direction was derived in this form (as
    // opposed to the direction the transfer was saved with).
    const directionDerivedRef = useRef(false);

    function deriveDirection() {
        const side = derivationSide();

        if (side) {
            directionDerivedRef.current = true;
            setValue("transferDirection", transferDirectionForType(side));
        }
    }

    useEffect(() => {
        const changed = previousTypeRef.current !== transactionType;
        const byCategory = typeSetByCategoryRef.current;
        previousTypeRef.current = transactionType;
        typeSetByCategoryRef.current = false;

        if (transactionType === "income" || transactionType === "expense") {
            if (changed) {
                shownSideRef.current = transactionType;

                if (!byCategory) {
                    manualSideRef.current = transactionType;
                }
            }

            if (getValues("transferDirection") != null) {
                setValue("transferDirection", null);
            }
            return;
        }

        if (transactionType === "transfer" && !getValues("transferDirection")) {
            deriveDirection();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transactionType]);

    // The statement side can arrive after the Type became Transfer: a
    // direction this form derived follows it (unless the user picked a
    // side by hand, or the category sets one). A saved transfer's own
    // direction is never touched.
    useEffect(() => {
        if (
            getValues("type") === "transfer" &&
            directionDerivedRef.current &&
            !manualSideRef.current
        ) {
            deriveDirection();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statementSide]);

    // Selecting a category (or another account, which can change a
    // mapping) sets the Type to the category's type - see
    // typeForSelectedCategory. Only a real change by the user does this:
    // never opening the form, and never categories / mappings finishing
    // loading. A Type picked by hand stays until the category changes.
    useEffect(() => {
        const previous = previousContextRef.current;
        previousContextRef.current = {
            accountId: accountId ?? "",
            categoryId: categoryId ?? "",
        };

        if (
            !previous ||
            (previous.accountId === (accountId ?? "") &&
                previous.categoryId === (categoryId ?? ""))
        ) {
            return;
        }

        const selectedType = typeForSelectedCategory(
            typeResolution.categoryType
        );

        // A newly chosen category is the user's latest intent: an earlier
        // Income / Expense picked by hand no longer decides the direction,
        // and a transfer takes the category's direction at once - also
        // when switching straight between two Transfer categories (the
        // Type stays Transfer, only the direction changes).
        if (previous.categoryId !== (categoryId ?? "")) {
            manualSideRef.current = null;

            if ((selectedType ?? getValues("type")) === "transfer") {
                if (categoryDirection) {
                    directionDerivedRef.current = true;
                    setValue("transferDirection", categoryDirection);
                } else {
                    // An either-way category doesn't keep a direction just
                    // because the transaction had one: it is re-derived -
                    // the bank statement's side first - so a saved Transfer
                    // Out that the statement shows as a credit becomes In
                    // when re-categorised. With no side to derive from (a
                    // manual transfer) the saved direction stays. Marked
                    // derived, so a statement side that arrives later
                    // still applies.
                    directionDerivedRef.current = true;
                    deriveDirection();
                }
            }
        }

        if (selectedType && selectedType !== getValues("type")) {
            typeSetByCategoryRef.current = true;
            setValue("type", selectedType, {
                shouldValidate: true,
                shouldDirty: true,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId, categoryId, typeResolution.categoryType]);

    // Exactly what will be saved (and what onSubmit receives) - see
    // finalTyping - and what is wrong with it: a conflict between the
    // category's direction and the bank statement (or the direction to be
    // saved) blocks saving; anything else is a warning.
    const isTransferCategory = (id: string | null | undefined) =>
        activeCategories.find(category => category.id === id)
            ?.categoryType === "TRANSFER";
    const transferDirectionValue = watch("transferDirection");
    const saved = finalTyping({
        type: transactionType,
        transferDirection: transferDirectionValue,
        isTransferCategory: isTransferCategory(categoryId),
        derivationSide: derivationSide(),
    });
    // Whether this edit leaves the category, Type and direction exactly as
    // the transaction was opened with (only then is an existing mismatch
    // with the statement tolerated).
    const typingUnchanged =
        (categoryId ?? "") === (defaultValues?.categoryId ?? "") &&
        saved.type === defaultValues?.type &&
        (saved.transferDirection ?? null) ===
            (defaultValues?.transferDirection ?? null);
    const checks = directionChecks({
        savedSide: sideOf(saved.type, saved.transferDirection),
        statementSide,
        categoryName: selectedCategoryForType?.name,
        categoryDirection,
        linkedMovementKind,
        originalSide,
        typingUnchanged,
    });
    const blocked = checks.blocking.length > 0;
    const directionLabel = (direction: string | null | undefined) =>
        direction === "IN" ? "In" : direction === "OUT" ? "Out" : null;

    return (
        <form
            className="space-y-5"
            onSubmit={handleSubmit(values => {
                // Never save a direction that contradicts the category /
                // statement (the Save button is disabled too).
                if (blocked) {
                    return;
                }

                return onSubmit({
                    ...values,
                    ...finalTyping({
                        type: values.type,
                        transferDirection: values.transferDirection,
                        isTransferCategory: isTransferCategory(values.categoryId),
                        derivationSide: derivationSide(),
                    }),
                });
            })}
        >
            <Section title="Transaction Details">
                <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                    <FormField
                        label="Account"
                        htmlFor="accountId"
                        required
                        error={errors.accountId?.message}
                    >
                        <Controller
                            control={control}
                            name="accountId"
                            render={({ field }) => {
                                const selectedAccount =
                                    activeAccounts.find(
                                        account =>
                                            account.id === field.value
                                    );

                                return (
                                    <Select
                                        value={field.value}
                                        onValueChange={field.onChange}
                                    >
                                        <SelectTrigger id="accountId">
                                            <SelectValue placeholder="Select Account">
                                                {selectedAccount?.name}
                                            </SelectValue>
                                        </SelectTrigger>

                                        <SelectContent>
                                            {activeAccounts.map(account => (
                                                <SelectItem
                                                    key={account.id}
                                                    value={account.id}
                                                >
                                                    {account.name}
                                                    {account.institutionName
                                                        ? ` - ${account.institutionName}`
                                                        : ""}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                );
                            }}
                        />
                    </FormField>

                    <FormField
                        label="Transaction Type"
                        htmlFor="type"
                        required
                        error={errors.type?.message}
                    >
                        <Controller
                            control={control}
                            name="type"
                            render={({ field }) => (
                                <>
                                    <Select
                                        value={field.value}
                                        onValueChange={
                                            isTypeLocked
                                                ? undefined
                                                : field.onChange
                                        }
                                        disabled={isTypeLocked}
                                    >
                                        <SelectTrigger id="type">
                                            <SelectValue placeholder="Select Type" />
                                        </SelectTrigger>

                                        <SelectContent>
                                            <SelectItem value="income">
                                                Income
                                            </SelectItem>
                                            <SelectItem value="expense">
                                                Expense
                                            </SelectItem>
                                            <SelectItem value="transfer">
                                                Transfer
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>

                                    {isTypeLocked && (
                                        <p className="text-xs leading-4 text-slate-500">
                                            Set automatically by a category
                                            mapping for this{" "}
                                            {typeResolution.source ===
                                            "account"
                                                ? "account"
                                                : "business entity"}
                                            .
                                        </p>
                                    )}

                                    {saved.type === "transfer" &&
                                        directionLabel(saved.transferDirection) && (
                                            <p className="text-xs leading-4 text-slate-500">
                                                {saved.type !== transactionType
                                                    ? `${selectedCategoryForType?.name ?? "This category"} is a Transfer category, so this will be saved as `
                                                    : "Will be saved as "}
                                                Transfer{" "}
                                                {directionLabel(saved.transferDirection)}
                                                {saved.transferDirection === "IN"
                                                    ? " - adds to this account's balance."
                                                    : " - reduces this account's balance."}
                                            </p>
                                        )}

                                    {checks.blocking.map(problem => (
                                        <p
                                            key={problem}
                                            role="alert"
                                            className="text-xs font-medium leading-4 text-red-600"
                                        >
                                            {problem}
                                        </p>
                                    ))}

                                    {checks.warnings.map(warning => (
                                        <p
                                            key={warning}
                                            className="text-xs leading-4 text-amber-700"
                                        >
                                            {warning}
                                        </p>
                                    ))}
                                </>
                            )}
                        />
                    </FormField>

                    <FormField
                        label="Category"
                        htmlFor="categoryId"
                        error={errors.categoryId?.message}
                    >
                        <Controller
                            control={control}
                            name="categoryId"
                            render={({ field }) => {
                                const selectedCategory =
                                    activeCategories.find(
                                        category =>
                                            category.id === field.value
                                    );

                                return (
                                    <Select
                                        value={field.value || "__none"}
                                        onValueChange={value =>
                                            field.onChange(
                                                value === "__none"
                                                    ? ""
                                                    : value
                                            )
                                        }
                                    >
                                        <SelectTrigger id="categoryId">
                                            <SelectValue placeholder="None">
                                                {selectedCategory?.name ?? "None"}
                                            </SelectValue>
                                        </SelectTrigger>

                                        <SelectContent>
                                            <SelectItem value="__none" label="None">
                                                None
                                            </SelectItem>

                                            {activeCategories.map(category => (
                                                <SelectItem
                                                    key={category.id}
                                                    value={category.id}
                                                >
                                                    {category.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                );
                            }}
                        />
                    </FormField>

                    <FormField
                        label="Subcategory"
                        htmlFor="subcategoryId"
                        error={errors.subcategoryId?.message}
                    >
                        <Input
                            id="subcategoryId"
                            placeholder="Optional subcategory"
                            {...register("subcategoryId")}
                        />
                    </FormField>

                    <FormField
                        label="Transaction Date"
                        htmlFor="transactionDate"
                        required
                        error={errors.transactionDate?.message}
                    >
                        <Input
                            id="transactionDate"
                            type="date"
                            {...register("transactionDate")}
                        />
                    </FormField>

                    <FormField
                        label="Payee / Merchant"
                        htmlFor="payee"
                        required
                        error={errors.payee?.message}
                    >
                        <Input
                            id="payee"
                            placeholder="e.g. Grocery Store"
                            {...register("payee")}
                        />
                    </FormField>

                    <FormField
                        label="Description"
                        htmlFor="description"
                        error={errors.description?.message}
                    >
                        <Input
                            id="description"
                            placeholder="Original transaction description (optional)"
                            {...register("description")}
                        />
                    </FormField>

                    <FormField
                        label="Amount"
                        htmlFor="amount"
                        required
                        error={errors.amount?.message}
                    >
                        <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            {...register("amount", {
                                valueAsNumber: true,
                            })}
                        />
                    </FormField>

                    <FormField
                        label="Status"
                        htmlFor="status"
                        required
                        error={errors.status?.message}
                    >
                        <Controller
                            control={control}
                            name="status"
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger id="status">
                                        <SelectValue />
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="CLEARED">
                                            Cleared
                                        </SelectItem>

                                        <SelectItem value="PENDING">
                                            Pending
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>
                </div>
            </Section>

            <Section title="Classification & Payment">
                <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                    <FormField
                        label="Tags"
                        htmlFor="tags"
                        error={errors.tags?.message}
                    >
                        <Input
                            id="tags"
                            placeholder="e.g. monthly, business"
                            {...register("tags")}
                        />
                    </FormField>

                    <FormField
                        label="Payment Method"
                        htmlFor="paymentMethod"
                        error={errors.paymentMethod?.message}
                    >
                        <Controller
                            control={control}
                            name="paymentMethod"
                            render={({ field }) => (
                                <Select
                                    value={field.value ?? "__none"}
                                    onValueChange={value =>
                                        field.onChange(
                                            value === "__none"
                                                ? null
                                                : value
                                        )
                                    }
                                >
                                    <SelectTrigger id="paymentMethod">
                                        <SelectValue placeholder="None">
                                            {field.value
                                                ? paymentTypeLabel(
                                                    paymentTypes,
                                                    field.value
                                                )
                                                : "None"}
                                        </SelectValue>
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="__none">
                                            None
                                        </SelectItem>

                                        {paymentMethodOptions.map(option => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>

                    {paymentMethod === "UPI" && (
                        <FormField
                            label="UPI Reference"
                            htmlFor="upiReference"
                            error={errors.upiReference?.message}
                        >
                            <Input
                                id="upiReference"
                                placeholder="Optional UPI reference"
                                {...register("upiReference")}
                            />
                        </FormField>
                    )}

                    {paymentMethod === "BANK_TRANSFER" && (
                        <FormField
                            label="Bank Transaction Reference"
                            htmlFor="bankTransactionReference"
                            error={errors.bankTransactionReference?.message}
                        >
                            <Input
                                id="bankTransactionReference"
                                placeholder="Optional bank reference"
                                {...register("bankTransactionReference")}
                            />
                        </FormField>
                    )}

                    {isCreditCardPaymentType(paymentMethod) && (
                        <FormField
                            label="Card Reference"
                            htmlFor="cardReference"
                            error={errors.cardReference?.message}
                        >
                            <Controller
                                control={control}
                                name="cardReference"
                                render={({ field }) => {
                                    const selectedCard =
                                        creditCardAccounts.find(
                                            account =>
                                                account.id === field.value
                                        );

                                    return (
                                        <Select
                                            value={field.value || ""}
                                            onValueChange={field.onChange}
                                        >
                                            <SelectTrigger id="cardReference">
                                                <SelectValue placeholder="Select credit card">
                                                    {selectedCard
                                                        ? creditCardOptionLabel(
                                                              selectedCard
                                                          )
                                                        : null}
                                                </SelectValue>
                                            </SelectTrigger>

                                            <SelectContent>
                                                {creditCardAccounts.map(
                                                    account => (
                                                        <SelectItem
                                                            key={account.id}
                                                            value={account.id}
                                                        >
                                                            {creditCardOptionLabel(
                                                                account
                                                            )}
                                                        </SelectItem>
                                                    )
                                                )}
                                            </SelectContent>
                                        </Select>
                                    );
                                }}
                            />
                        </FormField>
                    )}

                    {paymentMethod === "DEBIT_CARD" && (
                        <FormField
                            label="Card Reference"
                            htmlFor="cardReference"
                            error={errors.cardReference?.message}
                        >
                            <Input
                                id="cardReference"
                                placeholder="Optional card reference"
                                {...register("cardReference")}
                            />
                        </FormField>
                    )}
                </div>
            </Section>

            <Section title="Additional Information">
                <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                    <FormField
                        label="Reference Number"
                        htmlFor="referenceNumber"
                        error={errors.referenceNumber?.message}
                    >
                        <Input
                            id="referenceNumber"
                            placeholder="Optional reference"
                            {...register("referenceNumber")}
                        />
                    </FormField>

                    <FormField
                        label="Notes"
                        htmlFor="notes"
                        error={errors.notes?.message}
                    >
                        <Textarea
                            id="notes"
                            rows={2}
                            placeholder="Optional notes"
                            {...register("notes")}
                        />
                    </FormField>
                </div>
            </Section>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={loading}
                        className="h-9 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                )}

                <button
                    type="submit"
                    disabled={loading || blocked}
                    title={
                        blocked
                            ? "Resolve the direction conflict shown under Transaction Type first."
                            : undefined
                    }
                    className="h-9 cursor-pointer rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {loading ? "Saving..." : submitLabel}
                </button>
            </div>
        </form>
    );
}


