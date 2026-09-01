import {
    IconBell,
    IconCalendar,
    IconSearch,
    IconUserCircle,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function todayLabel(): string {
    return new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
    });
}

export default function AppHeader() {
    return (
        <header className="flex h-16 items-center justify-between border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-[#111827] px-10">

            <div className="relative w-[470px]">

                <IconSearch
                    size={20}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <Input
                    placeholder="Search transactions, accounts..."
                    className="h-11 rounded-xl border-transparent bg-slate-50 dark:bg-[#172033] dark:border-slate-700 pl-12"
                />

            </div>

            <div className="flex items-center gap-3">

                <div
                    className="flex h-11 items-center rounded-xl px-5 text-slate-600"
                    aria-label="Current date"
                >
                    <IconCalendar size={18} />

                    <span className="ml-2 text-sm font-medium">
                        {todayLabel()}
                    </span>
                </div>

                <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 rounded-xl border-transparent"
                >
                    <IconBell size={20} />
                </Button>

                <div className="flex items-center gap-3 rounded-xl bg-white dark:bg-[#172033] px-4 py-1.5">

                    <IconUserCircle
                        size={34}
                        className="text-slate-700"
                    />

                    <div>

                        <div className="font-semibold text-slate-900">
                            Administrator
                        </div>

                        <div className="text-sm text-slate-500">
                            FinanceOS
                        </div>

                    </div>

                </div>

            </div>

        </header>
    );
}


