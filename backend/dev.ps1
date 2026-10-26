$ErrorActionPreference = 'Stop'

function Read-Settings([string] $Path) {
    $settings = @{}
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
            $entry = $line.Trim()
            if (!$entry -or $entry.StartsWith('#')) { continue }
            if ($entry -notmatch '^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
                throw "Invalid setting in ${Path}. Expected KEY=value."
            }
            $key = $Matches[1]
            $value = $Matches[2].Trim()
            if ($value.Length -ge 2 -and (
                ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))
            )) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $settings[$key] = $value
        }
    }
    return $settings
}

function Get-Setting($Settings, [string] $Name, [string] $Fallback) {
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (![string]::IsNullOrWhiteSpace($value)) { return $value }
    if ($Settings.ContainsKey($Name)) { return $Settings[$Name] }
    return $Fallback
}

try {
    if (!(Get-Command go -ErrorAction SilentlyContinue)) {
        throw 'Go is not installed or is missing from PATH. Install Go 1.25 or newer.'
    }
    $configPath = Join-Path $PSScriptRoot '.env'
    if (!(Test-Path -LiteralPath $configPath)) {
        $postgres = Read-Settings (Join-Path (Split-Path $PSScriptRoot -Parent) '.env')
        $databaseURL = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')
        if ([string]::IsNullOrWhiteSpace($databaseURL)) {
            $password = Get-Setting $postgres 'POSTGRES_PASSWORD' ''
            if (!$password -or $password -eq 'replace-with-a-local-password') {
                $securePassword = Read-Host 'PostgreSQL password (saved locally in backend/.env)' -AsSecureString
                $password = [System.Net.NetworkCredential]::new('', $securePassword).Password
                if (!$password) { throw 'PostgreSQL password must not be empty.' }
            }
            $dbUser = [Uri]::EscapeDataString((Get-Setting $postgres 'POSTGRES_USER' 'uptime'))
            $dbPassword = [Uri]::EscapeDataString($password)
            $dbName = [Uri]::EscapeDataString((Get-Setting $postgres 'POSTGRES_DB' 'uptime'))
            $dbPort = Get-Setting $postgres 'POSTGRES_PORT' '55432'
            $databaseURL = "postgres://${dbUser}:${dbPassword}@localhost:${dbPort}/${dbName}?sslmode=disable"
        }
        $secretBytes = New-Object byte[] 48
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($secretBytes) } finally { $random.Dispose() }
        $secret = [Convert]::ToBase64String($secretBytes)
        $settingsText = @(
            '# Local development settings. Do not commit this file.'
            "DATABASE_URL=$databaseURL"
            "JWT_SECRET=$secret"
            'CLIENT_ORIGIN=http://localhost:3000'
            'COOKIE_SECURE=false'
            'PORT=8080'
        ) -join [Environment]::NewLine
        [System.IO.File]::WriteAllText($configPath, $settingsText + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
        Write-Host 'Created backend/.env. To change database settings, edit this file.'
    }
    $settings = Read-Settings $configPath
    foreach ($name in @('DATABASE_URL', 'JWT_SECRET', 'CLIENT_ORIGIN', 'COOKIE_SECURE', 'PORT')) {
        $value = Get-Setting $settings $name ''
        if ($value) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
    }
    Push-Location $PSScriptRoot
    try {
        Write-Host 'Starting backend. Keep PostgreSQL running in Docker Desktop. Press Ctrl+C to stop.'
        & go run ./cmd/server
        $serverExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($serverExitCode -ne 0) {
        Write-Host 'Backend did not start. Check PostgreSQL and DATABASE_URL in backend/.env.'
    }
    exit $serverExitCode
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
