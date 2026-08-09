import {
    IconBell,
    IconCalendar,
    IconChevronDown,
    IconPlus,
    IconSearch,
    IconUserCircle,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AppHeader() {
    return (
        <header className="flex h-16 items-center justify-between border-b border-transparent bg-white px-10">

            <div className="relative w-[470px]">

                <IconSearch
                    size={20}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <Input
                    placeholder="Search transactions, accounts..."
                    className="h-11 rounded-xl border-transparent bg-slate-50 pl-12"
                />

            </div>

            <div className="flex items-center gap-3">

                <Button
                    variant="outline"
                    className="h-11 rounded-xl border-transparent px-5"
                >
                    <IconCalendar size={18} />

                    <span className="mx-2">
                        July 2026
                    </span>

                    <IconChevronDown size={16} />
                </Button>

                <Button className="h-11 rounded-xl bg-slate-900 px-5 hover:bg-slate-800">

                    <IconPlus size={18} />

                    <span className="ml-2">
                        Add
                    </span>

                </Button>

                <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 rounded-xl border-transparent"
                >
                    <IconBell size={20} />
                </Button>

                <div className="flex items-center gap-3 rounded-xl  bg-white px-4 py-1.5">

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

