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
];

