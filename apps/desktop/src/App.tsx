import AppRoutes from "./routes";
import ThemeProvider from "./components/common/ThemeProvider";
import { Toaster } from "./components/ui/sonner";

export default function App() {
    return (
        <ThemeProvider>
            <AppRoutes />
            <Toaster />
        </ThemeProvider>
    );
}
