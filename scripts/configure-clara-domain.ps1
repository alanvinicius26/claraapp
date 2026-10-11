param([switch]$Connect)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectId = 'prj_GdJAEDPFnURqmlHXASsh13BdahS5'
$teamId = 'team_5K65dmEw8IQkQ1uJNW963bpT'
$credential = Import-Clixml -LiteralPath (Join-Path $projectRoot '.local/vercel/deploy-token.xml')
$headers = @{ Authorization = 'Bearer ' + $credential.GetNetworkCredential().Password }
$previousProtocol = [Net.ServicePointManager]::SecurityProtocol
try {
    [Net.ServicePointManager]::SecurityProtocol = $previousProtocol -bor [Net.SecurityProtocolType]::Tls12
    $project = Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/${projectId}?teamId=$teamId" -Headers $headers -TimeoutSec 30
    if ($project.id -ne $projectId -or $project.accountId -ne $teamId -or $project.name -ne 'encaixa') { throw 'Unexpected project' }
    $domains = Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/${projectId}/domains?teamId=$teamId" -Headers $headers -TimeoutSec 30
    if ($Connect) {
        foreach ($domainName in @('minhaclara.com','www.minhaclara.com')) {
            $existing = @($domains.domains | Where-Object { $_.name -eq $domainName })
            if ($existing.Count -eq 0) {
                $payload = @{ name = $domainName }
                if ($domainName -eq 'www.minhaclara.com') { $payload.redirect = 'minhaclara.com'; $payload.redirectStatusCode = 308 }
                $null = Invoke-RestMethod -Uri "https://api.vercel.com/v10/projects/${projectId}/domains?teamId=$teamId" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json) -TimeoutSec 30
            }
        }
        $domains = Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/${projectId}/domains?teamId=$teamId" -Headers $headers -TimeoutSec 30
    }
    $configurations = foreach ($domainName in @('minhaclara.com','www.minhaclara.com')) {
        try {
            $config = Invoke-RestMethod -Uri "https://api.vercel.com/v6/domains/${domainName}/config?projectId=$projectId&teamId=$teamId" -Headers $headers -TimeoutSec 30
        } catch {
            if ($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) {
                $config = [PSCustomObject]@{ status = 'not_found_before_domain_is_connected' }
            } else { throw }
        }
        [PSCustomObject]@{ domain = $domainName; configuration = $config }
    }
    $result = [PSCustomObject]@{
        projectId = $projectId
        domains = @($domains.domains | Select-Object name,verified,redirect,redirectStatusCode,verification)
        configurations = @($configurations)
        checkedAt = [DateTime]::UtcNow.ToString('o')
    }
    $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $projectRoot '.local/vercel/clara-domain-status.json') -Encoding UTF8
    $result | ConvertTo-Json -Depth 12
} catch {
    $statusCode = 0
    if ($null -ne $_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
    Write-Error "Domain configuration failed (HTTP $statusCode). No credentials were printed."
} finally {
    $headers.Clear()
    $credential = $null
    [Net.ServicePointManager]::SecurityProtocol = $previousProtocol
}
