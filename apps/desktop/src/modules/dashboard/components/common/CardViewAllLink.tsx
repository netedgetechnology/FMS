import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

interface CardViewAllLinkProps {
    /** Existing application route to open, e.g. "/accounts". */
    to: string;
    /** Accessible label / tooltip. Defaults to "View all". */
    label?: string;
}

/**
 * Compact icon control that replaces the old "View all" text links on
 * dashboard cards. Navigates to the card's existing full-list route.
 */
export function CardViewAllLink({
    to,
    label = "View all",
}: CardViewAllLinkProps) {
    return (
        <Link
            to={to}
            aria-label={label}
            title={label}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        >
            <ArrowUpRight size={16} />
        </Link>
    );
}
