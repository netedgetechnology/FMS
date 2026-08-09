$ErrorActionPreference = "Stop"

$desktop = Join-Path (Get-Location) "apps\desktop"
if (!(Test-Path $desktop)) {
    throw "Run this script from the FinanceOS project root."
}

$utf8 = [System.Text.UTF8Encoding]::new($false)

$vite = @'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
});
'@

[System.IO.File]::WriteAllText((Join-Path $desktop "vite.config.ts"), $vite, $utf8)

New-Item -ItemType Directory -Force (Join-Path $desktop "src\styles") | Out-Null

$css = @'
@import "tailwindcss";

:root {
  color-scheme: light dark;
}

html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
}

body {
  font-family: Inter, system-ui, sans-serif;
}
'@

[System.IO.File]::WriteAllText((Join-Path $desktop "src\styles\app.css"), $css, $utf8)

$mainPath = Join-Path $desktop "src\main.tsx"
$main = Get-Content $mainPath -Raw
$main = $main.Replace('import "./App.css";','import "./styles/app.css";')
[System.IO.File]::WriteAllText($mainPath, $main, $utf8)

Write-Host "Tailwind CSS v4 configuration complete."
