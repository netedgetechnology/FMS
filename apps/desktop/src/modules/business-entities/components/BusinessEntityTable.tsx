import { Eye, Pencil, Trash2 } from "lucide-react";

import { BusinessEntity } from "../types";

interface BusinessEntityTableProps {
    businessEntities: BusinessEntity[];

    onView: (entity: BusinessEntity) => void;

    onEdit: (entity: BusinessEntity) => void;

    onDelete: (entity: BusinessEntity) => void;
}

export function BusinessEntityTable({
    businessEntities,
    onView,
    onEdit,
    onDelete,
}: BusinessEntityTableProps) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-slate-100">
                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Business Entity
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Legal Name
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Tax ID
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Currency
                        </th>

                        <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Status
                        </th>

                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Actions
                        </th>
                    </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                    {businessEntities.map(entity => (
                        <tr
                            key={entity.id}
                            className="transition-colors hover:bg-slate-50/70"
                        >
                            <td className="px-4 py-3">
                                <div className="text-sm font-medium text-slate-800">
                                    {entity.name}
                                </div>

                                {entity.description && (
                                    <div className="mt-0.5 max-w-[320px] truncate text-[11px] text-slate-400">
                                        {entity.description}
                                    </div>
                                )}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-600">
                                {entity.legalName || "—"}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-600">
                                {entity.taxIdentifier || "—"}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-500">
                                {entity.currencyId}
                            </td>

                            <td className="px-4 py-3 text-center">
                                <span
                                    className={
                                        entity.isActive
                                            ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                                            : "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500"
                                    }
                                >
                                    {entity.isActive
                                        ? "Active"
                                        : "Inactive"}
                                </span>
                            </td>

                            <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onView(entity)
                                        }
                                        title="View business entity"
                                        aria-label={`View ${entity.name}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                    >
                                        <Eye size={15} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() =>
                                            onEdit(entity)
                                        }
                                        title="Edit business entity"
                                        aria-label={`Edit ${entity.name}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                    >
                                        <Pencil size={15} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() =>
                                            onDelete(entity)
                                        }
                                        title="Delete business entity"
                                        aria-label={`Delete ${entity.name}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
