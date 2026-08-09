import { Outlet } from "react-router-dom";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";

export default function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#F6F8FC]">

      <AppSidebar />

      <section className="flex min-w-0 flex-1 flex-col">

        <AppHeader />

        <main className="flex-1 overflow-y-auto">

          <div className="w-full px-4 pt-4 pb-6">

            <Outlet />

          </div>

        </main>

      </section>

    </div>
  );
}

