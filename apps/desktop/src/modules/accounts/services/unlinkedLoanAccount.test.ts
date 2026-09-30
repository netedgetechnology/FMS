import { describe, expect, it } from "vitest";

import { isUnlinkedLoanAccount } from "./unlinkedLoanAccount";
import { AccountType } from "../types/AccountType";

describe("isUnlinkedLoanAccount", () => {
    it("is true for a LOAN-type account with no matching loan link", () => {
        const linkedAccountIds = new Map([
            ["acct-linked", {}],
        ]);

        expect(
            isUnlinkedLoanAccount(
                { id: "acct-orphaned", type: AccountType.LOAN },
                linkedAccountIds
            )
        ).toBe(true);
    });

    it("is false for a LOAN-type account that is still linked to a live loan", () => {
        const linkedAccountIds = new Map([
            ["acct-linked", {}],
        ]);

        expect(
            isUnlinkedLoanAccount(
                { id: "acct-linked", type: AccountType.LOAN },
                linkedAccountIds
            )
        ).toBe(false);
    });

    it("is false for a non-LOAN account, even if it has no entry in linkedAccountIds", () => {
        const linkedAccountIds = new Map();

        for (const type of [
            AccountType.SAVINGS,
            AccountType.CURRENT,
            AccountType.CASH,
            AccountType.WALLET,
            AccountType.CREDIT_CARD,
            AccountType.INVESTMENT,
        ]) {
            expect(
                isUnlinkedLoanAccount(
                    { id: "acct-1", type },
                    linkedAccountIds
                )
            ).toBe(false);
        }
    });

    it("accepts a plain Set as well as a Map, since both expose .has()", () => {
        const linkedAccountIds = new Set(["acct-linked"]);

        expect(
            isUnlinkedLoanAccount(
                { id: "acct-orphaned", type: AccountType.LOAN },
                linkedAccountIds
            )
        ).toBe(true);
        expect(
            isUnlinkedLoanAccount(
                { id: "acct-linked", type: AccountType.LOAN },
                linkedAccountIds
            )
        ).toBe(false);
    });
});
