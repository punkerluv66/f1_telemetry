$ErrorActionPreference = "Stop"

$dbName = "f1_telemetry_platform_ts"
$hostName = "127.0.0.1"
$userName = "postgres"
$password = "1234"

$env:PGPASSWORD = $password

$exists = psql -h $hostName -U $userName -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$dbName';"

if ($exists -eq "1") {
  Write-Output "Database '$dbName' already exists."
  exit 0
}

psql -h $hostName -U $userName -d postgres -c "CREATE DATABASE $dbName TEMPLATE template0;"
Write-Output "Database '$dbName' created."
