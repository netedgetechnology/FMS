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
import { ImportMappingsMigration } from "./023_import_mappings";
import { TransactionChannelTypeMigration } from "./024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "./025_transaction_counterparty_branch";
import { CounterpartyRulesMigration } from "./026_counterparty_rules";
import { CounterpartyRulesAccountScopeMigration } from "./027_counterparty_rules_account_scope";
import { CounterpartyRulesTypeNotesMigration } from "./028_counterparty_rules_type_notes";
import { BackfillImportMappingNameMigration } from "./029_backfill_import_mapping_name";
import { FinancialPlansPhase1Migration } from "./030_financial_plans_phase1";
import { FinancialPlanComponentsMigration } from "./031_financial_plan_components";
import { GoalAccountLinksMigration } from "./032_goal_account_links";
import { GoalCategoryLinksMigration } from "./033_goal_category_links";
import { GoalLoanLinksMigration } from "./034_goal_loan_links";
import { GoalInvestmentLinksMigration } from "./035_goal_investment_links";
import { InvestmentPriceUpdatedAtMigration } from "./036_investment_price_updated_at";
import { LoanSchedulePaymentsMigration } from "./037_loan_schedule_payments";
import { CategoryContextMappingsMigration } from "./038_category_context_mappings";
import { CounterpartyRulesCategoryMigration } from "./039_counterparty_rules_category";
import { TransactionTransferDirectionMigration } from "./040_transaction_transfer_direction";
import { ImportCustomRulesMigration } from "./041_import_custom_rules";
import { ImportDraftsMigration } from "./042_import_drafts";

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
    ImportMappingsMigration,
    TransactionChannelTypeMigration,
    TransactionCounterpartyBranchMigration,
    CounterpartyRulesMigration,
    CounterpartyRulesAccountScopeMigration,
    CounterpartyRulesTypeNotesMigration,
    BackfillImportMappingNameMigration,
    FinancialPlansPhase1Migration,
    FinancialPlanComponentsMigration,
    GoalAccountLinksMigration,
    GoalCategoryLinksMigration,
    GoalLoanLinksMigration,
    GoalInvestmentLinksMigration,
    InvestmentPriceUpdatedAtMigration,
    LoanSchedulePaymentsMigration,
    CategoryContextMappingsMigration,
    CounterpartyRulesCategoryMigration,
    TransactionTransferDirectionMigration,
    ImportCustomRulesMigration,
    ImportDraftsMigration,
];

