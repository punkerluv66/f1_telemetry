$ErrorActionPreference = "Stop"

$configPath = Join-Path $PSScriptRoot "../.env"
if (-not (Test-Path -LiteralPath $configPath)) { throw "Create .env from .env.example in the repository root first." }
$configLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $configLine) { throw "DATABASE_URL is missing from .env." }
$databaseUri = [Uri]($configLine.Substring(13).Trim().Trim('"').Trim("'"))
$dbName = [Uri]::UnescapeDataString($databaseUri.AbsolutePath.TrimStart('/'))
$hostName = $databaseUri.Host
$portNumber = if ($databaseUri.Port -gt 0) { $databaseUri.Port } else { 5432 }
$credentials = $databaseUri.UserInfo.Split(':', 2)
$userName = [Uri]::UnescapeDataString($credentials[0])
$password = if ($credentials.Length -gt 1) { [Uri]::UnescapeDataString($credentials[1]) } else { "" }
if ($dbName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "Database name must contain letters, digits and underscores only." }

$env:PGPASSWORD = $password

# Check if psql is in PATH, if not, try to find it in common locations
$psqlPath = "psql"
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    $commonPaths = @(
        "C:\Program Files\PostgreSQL\18\bin\psql.exe",
        "C:\Program Files\PostgreSQL\17\bin\psql.exe",
        "C:\Program Files\PostgreSQL\16\bin\psql.exe",
        "C:\Program Files\PostgreSQL\15\bin\psql.exe",
        "C:\Program Files\PostgreSQL\14\bin\psql.exe"
    )
    foreach ($path in $commonPaths) {
        if (Test-Path $path) {
            $psqlPath = $path
            break
        }
    }
}

if (-not (Get-Command $psqlPath -ErrorAction SilentlyContinue) -and -not (Test-Path $psqlPath)) {
    Write-Error "psql not found. Please ensure PostgreSQL is installed and psql is in your PATH."
    exit 1
}

$exists = & $psqlPath -h $hostName -p $portNumber -U $userName -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$dbName';"

if ($LASTEXITCODE -ne 0) { throw "Could not connect to PostgreSQL. Check .env and the PostgreSQL service." }

if (([string]$exists).Trim() -eq "1") {
  Write-Output "Database '$dbName' already exists."
  exit 0
}

& $psqlPath -h $hostName -p $portNumber -U $userName -d postgres -c "CREATE DATABASE $dbName TEMPLATE template0;"
if ($LASTEXITCODE -ne 0) { throw "Database creation failed." }
Write-Output "Database '$dbName' created."
