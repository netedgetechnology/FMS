import { Eye, Pencil, Trash2 } from "lucide-react";

import { Category } from "../types";

interface CategoryTableProps {
    categories: Category[];
    onView: (category: Category) => void;
    onEdit: (category: Category) => void;
    onDelete: (category: Category) => void;
}

function formatType(value: string): string {
    return value
        .toLowerCase()
        .replace("_", " ")
        .replace(/\b\w/g, char => char.toUpperCase());
}

function formatScope(value: string): string {
    return value === "PERSONAL" ? "Personal" : "Business";
}

export function CategoryTable({
    categories,
    onView,
    onEdit,
    onDelete,
}: CategoryTableProps) {
    const categoryMap = new Map(
        categories.map(category => [category.id, category.name])
    );

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-slate-100">
                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Category
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Type
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Scope
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Parent
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
                    {categories.map(category => (
                        <tr
                            key={category.id}
                            className="transition-colors hover:bg-slate-50/70"
                        >
                            <td className="px-4 py-3">
                                <div className="text-sm font-medium text-slate-800">
                                    {category.parentId ? (
                                        <span className="mr-2 text-slate-300">
                                            ↳
                                        </span>
                                    ) : null}

                                    {category.name}
                                </div>

                                {category.description && (
                                    <div className="mt-0.5 max-w-[320px] truncate text-[11px] text-slate-400">
                                        {category.description}
                                    </div>
                                )}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-600">
                                {formatType(category.categoryType)}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-600">
                                {formatScope(category.financeScope)}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-500">
                                {category.parentId
                                    ? categoryMap.get(category.parentId) || "—"
                                    : "—"}
                            </td>

                            <td className="px-4 py-3 text-center">
                                <span
                                    className={
                                        category.isActive
                                            ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                                            : "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500"
                                    }
                                >
                                    {category.isActive ? "Active" : "Inactive"}
                                </span>
                            </td>

                            <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1">
                                    <button
                                        type="button"
                                        onClick={() => onView(category)}
                                        title="View category"
                                        aria-label={`View ${category.name}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                    >
                                        <Eye size={15} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => onEdit(category)}
                                        title="Edit category"
                                        aria-label={`Edit ${category.name}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                    >
                                        <Pencil size={15} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => onDelete(category)}
                                        title="Delete category"
                                        aria-label={`Delete ${category.name}`}
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
