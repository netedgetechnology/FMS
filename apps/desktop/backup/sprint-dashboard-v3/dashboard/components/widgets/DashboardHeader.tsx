import {
    CalendarDays,
    SlidersHorizontal,
    ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";

export function DashboardHeader() {
    return (

        <div className="mb-6 flex items-start justify-between">

            <div>

                <h1 className="text-[48px] font-black leading-none tracking-tight text-slate-900">
                    Dashboard
                </h1>

                <p className="mt-3 text-[18px] text-slate-500">
                    Good evening, User! Here's your financial overview.
                </p>

            </div>

            <div className="flex items-center gap-3">

                <Button
                    variant="outline"
                    className="h-14 rounded-2xl border-transparent px-6 text-[17px] shadow-sm"
                >

                    <CalendarDays className="mr-3 h-5 w-5" />

                    01 May 2025 - 31 May 2025

                    <ChevronDown className="ml-4 h-4 w-4" />

                </Button>

                <Button
                    variant="outline"
                    size="icon"
                    className="h-14 w-14 rounded-2xl border-transparent shadow-sm"
                >

                    <SlidersHorizontal className="h-5 w-5" />

                </Button>

            </div>

        </div>

    );
}

