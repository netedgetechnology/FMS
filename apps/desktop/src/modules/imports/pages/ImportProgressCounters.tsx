import { memo } from "react";
import { CheckCircle2 } from "lucide-react";

import type { ImportProgressCounts } from "./ImportsPage";

// Compact progress strip above the Import Preview table:
//   GREEN  learned      - rows an existing self-learned rule was applied to
//   BLUE   manual/left  - rows you processed by hand / rows still to process
//   BLACK  processed    - learned + manual (reaches Rows when all done)
// All three share one pill + outlined check-circle treatment (the same
// icon as the per-row Self-Learning indicator); only the colour differs.
// See countImportProgress for the exact counting rules.
function ImportProgressCountersComponent({
    counts,
}: {
    counts: ImportProgressCounts;
}) {
    return (
        <div
            data-testid="import-progress-counters"
            className="flex flex-wrap items-center gap-2 text-sm"
        >
            <span
                title="Learned: rows that already have learned values applied by Self-Learning"
                aria-label={`${counts.learned} rows learned`}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700"
            >
                <CheckCircle2 size={15} className="text-emerald-600" />
                <span className="tabular-nums">{counts.learned}</span>
                <span className="font-medium text-emerald-600">
                    Learned
                </span>
            </span>

            <span
                title="Manually processed / still to process: rows you have reviewed or edited in this preview, out of the rows not already learned"
                aria-label={`${counts.manual} rows manually processed, ${counts.remaining} remaining`}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-700"
            >
                <CheckCircle2 size={15} className="text-blue-600" />
                <span className="tabular-nums">
                    {counts.manual}
                    <span className="text-blue-400">/</span>
                    {counts.remaining}
                </span>
                <span className="font-medium text-blue-600">
                    Manual / Left
                </span>
            </span>

            <span
                title="Total processed = learned + manually processed rows"
                aria-label={`${counts.processed} of ${counts.total} rows processed`}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-900"
            >
                <CheckCircle2 size={15} className="text-slate-900" />
                <span className="tabular-nums">{counts.processed}</span>
                <span className="font-medium text-slate-900">
                    Processed of {counts.total}
                </span>
            </span>
        </div>
    );
}

export const ImportProgressCounters = memo(ImportProgressCountersComponent);
