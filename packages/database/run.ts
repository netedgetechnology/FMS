import { initializeDatabase } from "./src/client/initialize";
import { AccountService } from "./src/services/AccountService";

initializeDatabase();

const service = new AccountService();

const account = await service.createAccount({

    name: "HDFC Savings",

    accountType: "bank",

    institution: "HDFC Bank",

    openingBalance: 50000,

});

console.log("Created Account:");
console.log(account);

console.log("");

console.log("All Accounts:");

console.log(await service.listAccounts());
