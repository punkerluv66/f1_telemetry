$ErrorActionPreference = "Stop"

$dbName = "f1_telemetry_platform_ts"
$hostName = "127.0.0.1"
$userName = "postgres"
$password = "1234"

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

$exists = & $psqlPath -h $hostName -U $userName -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$dbName';"

if ($exists -eq "1") {
  Write-Output "Database '$dbName' already exists."
  exit 0
}

& $psqlPath -h $hostName -U $userName -d postgres -c "CREATE DATABASE $dbName TEMPLATE template0;"
Write-Output "Database '$dbName' created."
