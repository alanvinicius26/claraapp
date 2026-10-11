param(
    [string]$PackageDirectory = '.local/vercel/encaixa-links-20261005',
    [switch]$Status,
    [ValidateSet('production','preview')][string]$Target = 'production'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localDirectory = Join-Path $projectRoot '.local/vercel'
$stateFile = Join-Path $localDirectory $(if ($Target -eq 'preview') { 'last-preview-deployment.json' } else { 'last-deployment.json' })
$projectId = 'prj_GdJAEDPFnURqmlHXASsh13BdahS5'
$teamId = 'team_5K65dmEw8IQkQ1uJNW963bpT'
$credential = Import-Clixml -LiteralPath (Join-Path $localDirectory 'deploy-token.xml')
$headers = @{ Authorization = 'Bearer ' + $credential.GetNetworkCredential().Password }
$previousProtocol = [Net.ServicePointManager]::SecurityProtocol
try {
    [Net.ServicePointManager]::SecurityProtocol = $previousProtocol -bor [Net.SecurityProtocolType]::Tls12
    if ($Status) {
        $deployment = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $result = Invoke-RestMethod -Uri "https://api.vercel.com/v13/deployments/$($deployment.id)?teamId=$teamId" -Headers $headers -TimeoutSec 60
        $result | Select-Object id,url,readyState,target,alias,errorCode,errorMessage | ConvertTo-Json -Depth 5
        return
    }
    $project = Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/${projectId}?teamId=$teamId" -Headers $headers -TimeoutSec 30
    if ($project.id -ne $projectId -or $project.accountId -ne $teamId -or $project.name -ne 'encaixa') {
        throw 'Unexpected deployment destination.'
    }
    $packageRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot $PackageDirectory)).Path
    if (-not $packageRoot.StartsWith($localDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Package must be inside .local/vercel.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $packageRoot 'index.html'))) { throw 'Missing compiled index.html.' }
    $files = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File)
    $manifest = @()
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($packageRoot.Length + 1).Replace('\','/')
        if ($relative -notmatch '^(assets/[^/]+\.(js|css|png|webp)|index\.html|favicon\.svg|clara-icon-v[123]\.png|studio-portrait\.png|vercel\.json)$') {
            throw "Unexpected file in package: $relative"
        }
    }
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($packageRoot.Length + 1).Replace('\','/')
        $digest = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA1).Hash.ToLowerInvariant()
        $headers['x-vercel-digest'] = $digest
        $null = Invoke-RestMethod -Uri "https://api.vercel.com/v2/files?teamId=$teamId" -Method Post -Headers $headers -ContentType 'application/octet-stream' -InFile $file.FullName -TimeoutSec 60
        $manifest += @{ file=$relative; sha=$digest; size=$file.Length }
        Write-Host "Uploaded: $relative"
    }
    $headers.Remove('x-vercel-digest')
    $deploymentBody = @{
        name='encaixa'; project=$projectId; files=$manifest
        projectSettings=@{ framework=$null; buildCommand=$null; outputDirectory=$null }
    }
    # The REST API creates a preview when target is omitted.
    if ($Target -eq 'production') { $deploymentBody.target = 'production' }
    $payload = $deploymentBody | ConvertTo-Json -Depth 10
    $result = Invoke-RestMethod -Uri "https://api.vercel.com/v13/deployments?teamId=$teamId" -Method Post -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 60
    $summary = $result | Select-Object id,url,readyState,target
    $summary | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    $summary | ConvertTo-Json
} catch {
    # Never emit request headers or raw exception objects containing credentials.
    $statusCode = 0
    if ($null -ne $_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
    Write-Error "Deployment request failed (HTTP $statusCode). No credentials were printed."
} finally {
    $headers.Clear()
    $credential = $null
    [Net.ServicePointManager]::SecurityProtocol = $previousProtocol
}
