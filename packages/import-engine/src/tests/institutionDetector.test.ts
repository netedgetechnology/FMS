import { describe, expect, it } from "vitest";

import {
    detectInstitutionName,
} from "../parser/institutionDetector";

describe("detectInstitutionName", () => {
    it("detects the institution from footer/disclaimer text, without any bank-specific parser", () => {
        const content = [
            "Name :- NETEDGE TECHNOLOGY",
            "IFSC Code :- UTIB0000878",
            "Tran Date,Transaction Particulars,Amount(INR),DR|CR",
            "01-08-2026,ACH-DR-KOTAKMAHPRIMELTKKBK,9260.00,DR",
            "02-08-2026,NEFT/IN42621556482010,50000.00,CR",
            '"As a policy, Axis Bank never asks you to share confidential details."',
            '"BRANCH ADDRESS - AXIS BANK LTD, BOPAL, AHMEDABAD"',
        ].join("\n");

        expect(
            detectInstitutionName(content)
        ).toBe("Axis Bank");
    });

    it("is not fooled by a counterparty bank name inside a transaction narration", () => {
        // The transaction body repeatedly mentions "HDFC BANK LTD" as the
        // *counterparty* bank in UPI narrations; the statement's own
        // institution ("Axis Bank") only appears in the footer.
        const content = [
            "Tran Date,Transaction Particulars,Amount(INR),DR|CR",
            "01-08-2026,UPI/P2A/1/Some Person/Sent u/HDFC BANK LTD,150.00,DR",
            "02-08-2026,UPI/P2A/2/Other Person/Sent u/HDFC BANK LTD,250.00,DR",
            "03-08-2026,UPI/P2A/3/Third Person/Sent u/HDFC BANK LTD,350.00,DR",
            '"BRANCH ADDRESS - AXIS BANK LTD, BOPAL, AHMEDABAD"',
        ].join("\n");

        expect(
            detectInstitutionName(content)
        ).toBe("Axis Bank");
    });

    it("detects a different bank's name equally generically (no hardcoded institution list)", () => {
        const content = [
            "HDFC BANK LIMITED",
            "Date,Narration,Withdrawal,Deposit",
            "01/08/2026,ATM Withdrawal,5000,",
            "02/08/2026,Salary,,75000",
        ].join("\n");

        expect(
            detectInstitutionName(content)
        ).toBe("Hdfc Bank");
    });

    it("returns null when no bank name is present anywhere in the file", () => {
        const content = [
            "Date,Description,Amount",
            "01/08/2026,Coffee,250",
            "02/08/2026,Salary,50000",
        ].join("\n");

        expect(
            detectInstitutionName(content)
        ).toBeNull();
    });
});
