export interface FinancialPlanCategory {
    value: string;
    label: string;
    subcategories: {
        value: string;
        label: string;
    }[];
}

export const FINANCIAL_PLAN_CATEGORIES: FinancialPlanCategory[] = [
    {
        value: "CORE_PERSONAL_FINANCE",
        label: "Core Personal Finance",
        subcategories: [
            { value: "SAVINGS", label: "Savings" },
            { value: "EMERGENCY_FUND", label: "Emergency Fund" },
            { value: "ANNUAL_EXPENSES", label: "Annual Expenses" },
            { value: "MAJOR_PURCHASE", label: "Major Purchase" },
            { value: "VACATION_TRAVEL", label: "Vacation / Travel" },
            { value: "EDUCATION", label: "Education" },
            { value: "HOME_PURCHASE", label: "Home Purchase" },
            { value: "VEHICLE_PURCHASE", label: "Vehicle Purchase" },
            { value: "FAMILY_CHILDREN", label: "Family / Children" },
            { value: "HEALTHCARE", label: "Healthcare" },
        ],
    },
    {
        value: "LONG_TERM_WEALTH",
        label: "Long-Term / Wealth",
        subcategories: [
            { value: "RETIREMENT", label: "Retirement" },
            { value: "WEALTH_BUILDING", label: "Wealth Building" },
            { value: "INVESTMENT_GROWTH", label: "Investment Growth" },
            { value: "FINANCIAL_INDEPENDENCE", label: "Financial Independence" },
            { value: "ESTATE_PLANNING", label: "Estate Planning" },
        ],
    },
    {
        value: "DEBT_LIABILITIES",
        label: "Debt & Liabilities",
        subcategories: [
            { value: "DEBT_REDUCTION", label: "Debt Reduction" },
            { value: "CREDIT_CARD_PAYOFF", label: "Credit Card Payoff" },
            { value: "LOAN_REPAYMENT", label: "Loan Repayment" },
            { value: "MORTGAGE_PAYOFF", label: "Mortgage Payoff" },
        ],
    },
    {
        value: "BUSINESS_PROFESSIONAL",
        label: "Business & Professional",
        subcategories: [
            { value: "BUSINESS_FINANCE", label: "Business Finance" },
            { value: "BUSINESS_EXPANSION", label: "Business Expansion" },
            { value: "WORKING_CAPITAL", label: "Working Capital" },
            { value: "BUSINESS_INVESTMENT", label: "Business Investment" },
            { value: "PROFESSIONAL_DEVELOPMENT", label: "Professional Development" },
        ],
    },
    {
        value: "PROTECTION_RISK",
        label: "Protection & Risk",
        subcategories: [
            { value: "INSURANCE_PLANNING", label: "Insurance Planning" },
            { value: "MEDICAL_RESERVE", label: "Medical Reserve" },
            { value: "EMERGENCY_PREPAREDNESS", label: "Emergency Preparedness" },
        ],
    },
    {
        value: "TAX_COMPLIANCE",
        label: "Tax & Compliance",
        subcategories: [
            { value: "TAX_PLANNING", label: "Tax Planning" },
            { value: "TAX_SAVING", label: "Tax Saving" },
            { value: "TAX_RESERVE", label: "Tax Reserve" },
        ],
    },
];

export function getFinancialPlanCategory(
    value: string
): FinancialPlanCategory | undefined {
    return FINANCIAL_PLAN_CATEGORIES.find(
        category => category.value === value
    );
}

export function getFinancialPlanSubcategoryLabel(
    categoryValue: string,
    subcategoryValue: string
): string {
    return (
        getFinancialPlanCategory(categoryValue)
            ?.subcategories.find(
                subcategory => subcategory.value === subcategoryValue
            )?.label ?? subcategoryValue
    );
}
