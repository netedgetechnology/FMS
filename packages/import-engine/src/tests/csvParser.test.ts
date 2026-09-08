import { describe, expect, it } from "vitest";

import {
    parseCsv,
} from "../parser/csvParser";

describe("parseCsv", () => {
    it("never assumes row 1 is the header: skips metadata before the real table", () => {
        const content = [
            "Name :- NETEDGE TECHNOLOGY",
            "Joint Holder :- -",
            "10, 4TH FLOOR, AMRAPALI AXIOM, OPP. BHOPAL",
            "BRIDGE, AMBALI, BHOPAL, AHMEDABAD",
            "Statement of Account No - 912020020993999 for the period (From : 01-08-2026 To : 31-08-2026)",
            "Tran Date,Value Date,CHQNO,Transaction Particulars,Amount(INR),DR|CR,Balance(INR),Branch Name",
            "01-08-2026,01-08-2026,-,ACH-DR-KOTAKMAHPRIMELTKKBK,9260.00,DR,54981.96,BOPAL, AHMEDABAD [GJ]",
            "01-08-2026,01-08-2026,-,UPI/P2A/621333332818,150.00,DR,54831.96,BOPAL, AHMEDABAD [GJ]",
            "02-08-2026,02-08-2026,-,NEFT/IN42621556482010,50000.00,CR,104831.96,RTGS HUB",
        ].join("\n");

        const document = parseCsv(content);

        expect(document.headers).toEqual([
            "Tran Date",
            "Value Date",
            "CHQNO",
            "Transaction Particulars",
            "Amount(INR)",
            "DR|CR",
            "Balance(INR)",
            "Branch Name",
        ]);

        expect(document.rows).toHaveLength(3);

        // Branch Name contains an unquoted comma; the overflow field is
        // folded back into the last column rather than corrupting the
        // positional alignment of the earlier (mapped) columns.
        expect(document.rows[0]?.values).toEqual([
            "01-08-2026",
            "01-08-2026",
            "-",
            "ACH-DR-KOTAKMAHPRIMELTKKBK",
            "9260.00",
            "DR",
            "54981.96",
            "BOPAL,AHMEDABAD [GJ]",
        ]);
    });

    it("stops at the end of the contiguous transaction body, excluding trailing footer/disclaimer/legend text", () => {
        const content = [
            "Tran Date,Value Date,CHQNO,Transaction Particulars,Amount(INR),DR|CR,Balance(INR),Branch Name",
            "01-08-2026,01-08-2026,-,ACH-DR-KOTAKMAHPRIMELTKKBK,9260.00,DR,54981.96,BOPAL, AHMEDABAD [GJ]",
            "01-08-2026,01-08-2026,-,UPI/P2A/621333332818,150.00,DR,54831.96,BOPAL, AHMEDABAD [GJ]",
            "02-08-2026,02-08-2026,-,NEFT/IN42621556482010,50000.00,CR,104831.96,RTGS HUB",
            '"Unless the constituent notifies the bank immediately, this statement stands correct."',
            '"The closing balance shown includes funds under clearing."',
            "Legend : ",
            " ICONN , Transaction through Internet Banking ",
            "BRN ,  Branch ",
            '"BRANCH ADDRESS - SOME BANK LTD, SOME BUILDING, SOME ROAD, SOME CITY',
        ].join("\n");

        const document = parseCsv(content);

        expect(document.rows).toHaveLength(3);

        expect(
            document.rows.map(
                row => row.values[3]
            )
        ).toEqual([
            "ACH-DR-KOTAKMAHPRIMELTKKBK",
            "UPI/P2A/621333332818",
            "NEFT/IN42621556482010",
        ]);
    });

    it("keeps a ragged-but-structurally-consistent row inside the body (one missing trailing field)", () => {
        const content = [
            "Date,Description,Amount,Reference",
            "01/08/2026,Coffee,250,REF001",
            "02/08/2026,Salary,50000",
            "03/08/2026,Rent,20000,REF003",
        ].join("\n");

        const document = parseCsv(content);

        expect(document.rows).toHaveLength(3);

        expect(document.rows[1]?.values).toEqual([
            "02/08/2026",
            "Salary",
            "50000",
            "",
        ]);
    });

    it("handles quoted fields containing the delimiter", () => {
        const content = [
            "Date,Description,Amount",
            '21/08/2026,"Amazon, India Pvt Ltd",1250.50',
        ].join("\n");

        const document = parseCsv(content);

        expect(document.headers).toEqual([
            "Date",
            "Description",
            "Amount",
        ]);

        expect(document.rows[0]?.values).toEqual([
            "21/08/2026",
            "Amazon, India Pvt Ltd",
            "1250.50",
        ]);
    });

    it("detects a semicolon delimiter", () => {
        const content = [
            "Date;Description;Amount;Type",
            "01/08/2026;Coffee;250;Debit",
            "02/08/2026;Salary;50000;Credit",
            "03/08/2026;Rent;20000;Debit",
        ].join("\n");

        const document = parseCsv(content);

        expect(document.headers).toEqual([
            "Date",
            "Description",
            "Amount",
            "Type",
        ]);

        expect(document.rows).toHaveLength(3);

        expect(document.rows[0]?.values).toEqual([
            "01/08/2026",
            "Coffee",
            "250",
            "Debit",
        ]);
    });

    it("detects a tab delimiter", () => {
        const content = [
            "Date\tDescription\tAmount",
            "01/08/2026\tCoffee\t250",
            "02/08/2026\tSalary\t50000",
            "03/08/2026\tRent\t20000",
        ].join("\n");

        const document = parseCsv(content);

        expect(document.headers).toEqual([
            "Date",
            "Description",
            "Amount",
        ]);

        expect(document.rows).toHaveLength(3);
    });

    it("pads rows that are missing trailing fields", () => {
        const content = [
            "Date,Description,Amount,Reference",
            "01/08/2026,Coffee,250",
            "02/08/2026,Salary,50000,REF002",
        ].join("\n");

        const document = parseCsv(content);

        expect(document.rows[0]?.values).toEqual([
            "01/08/2026",
            "Coffee",
            "250",
            "",
        ]);
    });

    it("still treats line 1 as the header for a simple, already-clean CSV", () => {
        const content = [
            "Date,Description,Amount,Type,Reference",
            "21/08/2026,Amazon,1250.50,Debit,REF001",
            "22/08/2026,Salary,75000,Credit,REF002",
        ].join("\n");

        const document = parseCsv(content);

        expect(document.headers).toEqual([
            "Date",
            "Description",
            "Amount",
            "Type",
            "Reference",
        ]);

        expect(document.rows).toHaveLength(2);
    });

    it("strips a UTF-8 BOM before parsing", () => {
        const content =
            "﻿Date,Description,Amount\n21/08/2026,Amazon,1250.50";

        const document = parseCsv(content);

        expect(document.headers[0]).toBe("Date");
    });
});
