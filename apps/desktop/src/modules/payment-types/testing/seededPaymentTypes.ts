import { SEEDED_PAYMENT_TYPES } from "@/core/database/migrations/044_payment_types";

import type { PaymentType, PaymentTypeOption } from "../types";
import { activePaymentTypeOptions } from "../utils";

// Test fixture: the Payment Type master list exactly as migration 044
// seeds it, for tests that render a Payment Type selector without a
// database. Derived from the migration's own seed - not a second list.
export const SEEDED_PAYMENT_TYPE_LIST: readonly PaymentType[] =
    SEEDED_PAYMENT_TYPES.map((type, index) => ({
        id: `pt-${type.code.toLowerCase()}`,
        code: type.code,
        label: type.label,
        isActive: type.isActive,
        sortOrder: (index + 1) * 10,
        createdAt: "2026-10-05T00:00:00.000Z",
        updatedAt: "2026-10-05T00:00:00.000Z",
    }));

export const SEEDED_ACTIVE_PAYMENT_TYPE_OPTIONS: readonly PaymentTypeOption[] =
    activePaymentTypeOptions(SEEDED_PAYMENT_TYPE_LIST);
