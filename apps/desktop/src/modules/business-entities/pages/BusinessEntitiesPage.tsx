import {
    useState,
} from "react";

import {
    Plus,
} from "lucide-react";

import {
    AddBusinessEntityDialog,
    BusinessEntityTable,
    DeleteBusinessEntityDialog,
    EditBusinessEntityDialog,
    ViewBusinessEntityDialog,
} from "../components";

import {
    useBusinessEntities,
} from "../hooks";

import {
    BusinessEntity,
} from "../types";

export default function BusinessEntitiesPage() {
    const {
        businessEntities,
        loading,
        error,
        refresh,
    } = useBusinessEntities();

    const [
        selectedEntity,
        setSelectedEntity,
    ] = useState<BusinessEntity | null>(null);

    const [
        viewOpen,
        setViewOpen,
    ] = useState(false);

    const [
        editOpen,
        setEditOpen,
    ] = useState(false);

    const [
        deleteOpen,
        setDeleteOpen,
    ] = useState(false);

    function handleView(
        entity: BusinessEntity
    ) {
        setSelectedEntity(entity);
        setViewOpen(true);
    }

    function handleEdit(
        entity: BusinessEntity
    ) {
        setSelectedEntity(entity);
        setEditOpen(true);
    }

    function handleDelete(
        entity: BusinessEntity
    ) {
        setSelectedEntity(entity);
        setDeleteOpen(true);
    }

    async function handleRefresh() {
        await refresh();
    }

    return (
        <div className="space-y-6">

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                        Business Entities
                    </h1>

                    <p className="mt-1 text-sm text-slate-500">
                        Manage the businesses used for tracking business finances.
                    </p>
                </div>

                <AddBusinessEntityDialog
                    onSuccess={handleRefresh}
                    trigger={
                        <button
                            type="button"
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]"
                        >
                            <Plus size={16} />
                            Add Business Entity
                        </button>
                    }
                />
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

                {loading ? (
                    <div className="px-6 py-12 text-center text-sm text-slate-500">
                        Loading business entities...
                    </div>
                ) : error ? (
                    <div className="px-6 py-12 text-center">
                        <p className="text-sm font-medium text-red-600">
                            Failed to load business entities.
                        </p>

                        <p className="mt-1 text-xs text-slate-500">
                            {error}
                        </p>

                        <button
                            type="button"
                            onClick={handleRefresh}
                            className="mt-4 h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
                        >
                            Try Again
                        </button>
                    </div>
                ) : businessEntities.length === 0 ? (
                    <div className="px-6 py-14 text-center">
                        <div className="text-sm font-medium text-slate-800">
                            No business entities yet
                        </div>

                        <div className="mt-1 text-sm text-slate-500">
                            Add your first business entity to start managing business finances.
                        </div>

                        <div className="mt-5">
                            <AddBusinessEntityDialog
                                onSuccess={handleRefresh}
                            />
                        </div>
                    </div>
                ) : (
                    <BusinessEntityTable
                        businessEntities={
                            businessEntities
                        }
                        onView={handleView}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                    />
                )}

            </div>

            <ViewBusinessEntityDialog
                entity={selectedEntity}
                open={viewOpen}
                onOpenChange={
                    setViewOpen
                }
            />

            <EditBusinessEntityDialog
                entity={selectedEntity}
                open={editOpen}
                onOpenChange={
                    setEditOpen
                }
                onSuccess={handleRefresh}
            />

            <DeleteBusinessEntityDialog
                entity={selectedEntity}
                open={deleteOpen}
                onOpenChange={
                    setDeleteOpen
                }
                onSuccess={async () => {
                    setSelectedEntity(null);
                    await handleRefresh();
                }}
            />

        </div>
    );
}
