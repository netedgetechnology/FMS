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
];

