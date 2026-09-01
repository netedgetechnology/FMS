import { describe, expect, it } from "vitest";

import { accountSchema } from "./accountSchema";
import { AccountType } from "../types";

const baseInput = {
    name: "HDFC Savings",
    type: AccountType.SAVINGS,
    businessEntityId: "be-123",
    currencyId: "cur-inr",
    openingBalance: 0,
    isActive: true,
};

describe("accountSchema — business entity", () => {
    it("accepts an account with a business entity selected", () => {
        const result = accountSchema.safeParse(baseInput);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.businessEntityId).toBe("be-123");
        }
    });

    it("rejects an account with no business entity selected", () => {
        const result = accountSchema.safeParse({
            ...baseInput,
            businessEntityId: "",
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (issue) =>
                        issue.path.join(".") === "businessEntityId",
                ),
            ).toBe(true);
        }
    });

    it("rejects an account missing the business entity field entirely", () => {
        const { businessEntityId: _omit, ...withoutEntity } = baseInput;
        void _omit;

        expect(accountSchema.safeParse(withoutEntity).success).toBe(false);
    });

    it("still validates the existing required fields", () => {
        expect(
            accountSchema.safeParse({ ...baseInput, name: "" }).success,
        ).toBe(false);
        expect(
            accountSchema.safeParse({ ...baseInput, currencyId: "" }).success,
        ).toBe(false);
    });
});
