$ErrorActionPreference = "Stop"

Write-Host "== FinanceOS Shell Scaffold =="

$dirs = @(
"src/app",
"src/layouts",
"src/routes",
"src/pages/Dashboard",
"src/pages/Accounts",
"src/pages/Transactions",
"src/pages/Contacts",
"src/pages/Categories",
"src/pages/Budgets",
"src/pages/Investments",
"src/pages/Loans",
"src/pages/Reports",
"src/pages/Settings",
"src/components/layout",
"src/components/navigation",
"src/components/dashboard",
"src/components/common",
"src/hooks",
"src/stores",
"src/services",
"src/types",
"src/utils"
)

foreach($d in $dirs){
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

Write-Host "Folders created."
