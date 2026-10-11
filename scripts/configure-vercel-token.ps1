$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'Este script usa a protecao de credenciais do Windows.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$credentialDirectory = Join-Path $projectRoot '.local/vercel'
$credentialPath = Join-Path $credentialDirectory 'deploy-token.xml'

Write-Host 'Cole o token da Vercel abaixo e pressione Enter. O valor ficara oculto.'
$secureToken = Read-Host 'Token da Vercel' -AsSecureString
if ($secureToken.Length -eq 0) {
    throw 'Nenhum token informado. Nada foi salvo.'
}

$credential = New-Object System.Management.Automation.PSCredential('vercel', $secureToken)
$requestHeaders = @{ Authorization = 'Bearer ' + $credential.GetNetworkCredential().Password.Trim() }
$previousProtocol = [Net.ServicePointManager]::SecurityProtocol
try {
    [Net.ServicePointManager]::SecurityProtocol = $previousProtocol -bor [Net.SecurityProtocolType]::Tls12
    $project = Invoke-RestMethod -Uri 'https://api.vercel.com/v9/projects/encaixa?slug=bertunesinc-3931' -Headers $requestHeaders -Method Get -TimeoutSec 30
} catch {
    $statusCode = 0
    if ($null -ne $_.Exception.Response) {
        $statusCode = [int]$_.Exception.Response.StatusCode
    }
    $diagnostic = switch ($statusCode) {
        401 { 'HTTP 401: token nao aceito. Confira se foi copiado inteiro e se ainda esta valido.' }
        403 { 'HTTP 403: acesso negado. Confira a validade do token e o acesso a equipe bertunesinc-3931 e ao projeto encaixa.' }
        404 { 'HTTP 404: projeto encaixa nao encontrado ou nao acessivel na equipe bertunesinc-3931.' }
        429 { 'HTTP 429: limite temporario da Vercel. Aguarde um pouco e tente novamente.' }
        0 { 'Sem resposta HTTP: falha de conexao, TLS, DNS, proxy ou tempo limite.' }
        default { "HTTP ${statusCode}: falha na resposta da Vercel. Tente novamente mais tarde." }
    }
    $secureToken.Dispose()
    $credential = $null
    throw "$diagnostic Nenhum token novo foi salvo."
} finally {
    $requestHeaders.Clear()
    [Net.ServicePointManager]::SecurityProtocol = $previousProtocol
}

if ($project.name -ne 'encaixa' -or -not $project.id -or -not $project.accountId) {
    $secureToken.Dispose()
    $credential = $null
    throw 'A resposta nao identificou o projeto esperado. Nenhum token novo foi salvo.'
}

# Store the trimmed value too, so subsequent deploys use exactly what was validated.
$normalizedToken = ConvertTo-SecureString $credential.GetNetworkCredential().Password.Trim() -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential('vercel', $normalizedToken)
New-Item -ItemType Directory -Path $credentialDirectory -Force | Out-Null
$credential | Export-Clixml -LiteralPath $credentialPath
@{ projectId = $project.id; orgId = $project.accountId; projectName = $project.name } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $credentialDirectory 'project.json') -Encoding UTF8
$secureToken.Dispose()
$normalizedToken.Dispose()
$credential = $null
Write-Host 'Token validado e salvo com criptografia vinculada ao seu usuario do Windows.'
Write-Host 'Acesso de leitura ao projeto encaixa confirmado. Permissao de deploy sera verificada na publicacao.'
Write-Host 'Agora volte ao Codex e diga: token configurado.'
