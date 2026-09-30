import { useState } from "react";
import {
    IconBell,
    IconSearch,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCurrencySymbol, useDisplaySettings } from "@/core/formatting";

function todayLabel(): string {
    return new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
    });
}

export default function AppHeader() {
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const { defaultCurrency } = useDisplaySettings();

    return (
        <header className="flex h-16 items-center justify-end border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-[#111827] px-10">

            {isSearchOpen && (
                <div className="relative mr-3 w-[470px]">

                    <IconSearch
                        size={20}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                    />

                    <Input
                        autoFocus
                        placeholder="Search transactions, accounts..."
                        className="h-11 rounded-xl border-transparent bg-slate-50 dark:bg-[#172033] dark:border-slate-700 pl-12"
                    />

                </div>
            )}

            <div className="flex items-center gap-3">

                <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 rounded-xl border-transparent"
                    aria-label="Search"
                    onClick={() => setIsSearchOpen((open) => !open)}
                >
                    <IconSearch size={20} />
                </Button>

                <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 rounded-xl border-transparent"
                    aria-label={`Default Currency (${defaultCurrency})`}
                    title={`Default Currency (${defaultCurrency})`}
                >
                    <span className="text-lg font-semibold leading-none">
                        {getCurrencySymbol(defaultCurrency)}
                    </span>
                </Button>

                <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 rounded-xl border-transparent"
                >
                    <IconBell size={20} />
                </Button>

                <div
                    className="flex h-11 items-center rounded-xl px-5 text-slate-600"
                    aria-label="Current date"
                >
                    <span className="text-sm font-medium">
                        {todayLabel()}
                    </span>
                </div>

            </div>

        </header>
    );
}


