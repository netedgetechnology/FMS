import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./styles/globals.css";
import { initializeDatabase } from "./core/database/bootstrap";
import { runDailyDatabaseBackup } from "./core/database/dailyDatabaseBackup";


async function startApplication() {

    try {

        await initializeDatabase();

        ReactDOM.createRoot(
            document.getElementById("root")!
        ).render(
            <React.StrictMode>
                <BrowserRouter>
                    <App />
                </BrowserRouter>
            </React.StrictMode>
        );

        // Local, once-per-day database backup. Fire-and-forget and
        // deferred so it never delays startup; all failures are handled
        // inside runDailyDatabaseBackup and can never reach here.
        setTimeout(() => {
            void runDailyDatabaseBackup();
        }, 3000);

    } catch (error) {

        const message =
            error instanceof Error
                ? error.message
                : String(error);

        ReactDOM.createRoot(
            document.getElementById("root")!
        ).render(
            <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
                <div className="w-full max-w-2xl rounded-3xl bg-white p-8 shadow-lg">
                    <h1 className="text-xl font-semibold text-red-600">
                        FinanceOS Database Startup Error
                    </h1>

                    <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-100 p-4 text-sm text-slate-700">
                        {message}
                    </pre>
                </div>
            </div>
        );

        console.error(
            "FinanceOS startup failed:",
            error
        );

    }

}


void startApplication();

























