import { InitialSchemaMigration } from "./001_initial_schema";
import { SeedDataMigration } from "./002_seed_data";
import { TransactionSchemaMigration } from "./003_transactions";
import { FinanceFoundationMigration } from "./004_finance_foundation";
import { LoansEMIMigration } from "./005_loans_emi";
import { InvestmentsMigration } from "./006_investments";
import { PlanningMigration } from "./007_planning";
import { ApplicationInfrastructureMigration } from "./008_application_infrastructure";
import { CurrencyExpansionMigration } from "./009_currency_expansion";
import { CreditCardsMigration } from "./010_credit_cards";
import { FinancialPlanCategoriesMigration } from "./011_financial_plan_categories";
import { FinancialGoalCategoriesMigration } from "./012_financial_goal_categories";
import { ImportDuplicateCountMigration } from "./013_import_duplicate_count";
import { TransactionDetailsMigration } from "./014_transaction_details";
import { AccountBusinessEntityMigration } from "./015_account_business_entity";
import { InvestmentAccountLinkMigration } from "./016_investment_account_link";
import { InvestmentAccountZeroBalanceMigration } from "./017_investment_account_zero_balance";
import { InvestmentBusinessEntityMigration } from "./018_investment_business_entity";
import { RestoreOrphanedInvestmentAccountsMigration } from "./019_restore_orphaned_investment_accounts";
import { LoanAccountLinkMigration } from "./021_loan_account_link";
import { LoanPaidInstallmentsMigration } from "./022_loan_paid_installments";

export const migrations = [
    InitialSchemaMigration,
    SeedDataMigration,
    TransactionSchemaMigration,
    FinanceFoundationMigration,
    LoansEMIMigration,
    InvestmentsMigration,
    PlanningMigration,
    ApplicationInfrastructureMigration,
    CurrencyExpansionMigration,
    CreditCardsMigration,
    FinancialPlanCategoriesMigration,
    FinancialGoalCategoriesMigration,
    ImportDuplicateCountMigration,
    TransactionDetailsMigration,
    AccountBusinessEntityMigration,
    InvestmentAccountLinkMigration,
    InvestmentAccountZeroBalanceMigration,
    InvestmentBusinessEntityMigration,
    RestoreOrphanedInvestmentAccountsMigration,
    LoanAccountLinkMigration,
    LoanPaidInstallmentsMigration,
];

