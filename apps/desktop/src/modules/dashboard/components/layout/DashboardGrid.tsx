import { ReactNode } from "react";

export function DashboardGrid({
    children,
}:{
    children:ReactNode;
}){

    return(

        <div
            className="
                grid
                gap-6
                xl:grid-cols-12
                auto-rows-auto
            "
        >

            {children}

        </div>

    );

}

