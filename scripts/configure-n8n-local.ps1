param([string]$Docker = 'C:/Users/Alan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $projectRoot '.local/whatsapp-sim'
$secretFile = Join-Path $localRoot 'server-secrets.json'
if (!(Test-Path -LiteralPath $secretFile)) { throw 'Inicie o simulador primeiro.' }
$secrets = Get-Content -Raw -LiteralPath $secretFile | ConvertFrom-Json
$credentialsFile = Join-Path $localRoot 'n8n-credential-import.json'
$credentials = @(@{ id='clara-whatsapp-local-header'; name='Clara — ponte local (simulação)'; type='httpHeaderAuth'; data=@{name='Authorization';value=('Bearer ' + $secrets.CLARA_N8N_SECRET)} })
ConvertTo-Json -Depth 5 -InputObject $credentials | Set-Content -LiteralPath $credentialsFile -Encoding utf8
try {
  & $Docker exec -u node n8n n8n export:workflow --id=fWw0sNDvnpUn1Vr1 --output=/tmp/clara-initial-backup.json
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preservar o fluxo inicial.' }
  & $Docker cp 'n8n:/tmp/clara-initial-backup.json' (Join-Path $localRoot 'initial-workflow-backup.json')
  & $Docker cp $credentialsFile 'n8n:/tmp/clara-credential-import.json'
  & $Docker exec -u node n8n n8n import:credentials --input=/tmp/clara-credential-import.json --projectId=HvuMHDLU0Bfw59Ms
  if ($LASTEXITCODE -ne 0) { throw 'Importação de credencial falhou.' }
  foreach ($name in @('clara-queue.simulation.json','clara-inbound.simulation.json')) {
    & $Docker cp (Join-Path $projectRoot ('integrations/n8n/' + $name)) ('n8n:/tmp/' + $name)
    & $Docker exec -u node n8n n8n import:workflow ('--input=/tmp/' + $name) --projectId=HvuMHDLU0Bfw59Ms
    if ($LASTEXITCODE -ne 0) { throw 'Importação de workflow falhou.' }
  }
} finally {
  & $Docker exec -u root n8n rm -f /tmp/clara-credential-import.json
  # One exact, verified workspace file; never delete directories recursively.
  if ([IO.Path]::GetFullPath($credentialsFile).StartsWith([IO.Path]::GetFullPath($localRoot) + [IO.Path]::DirectorySeparatorChar)) {
    Remove-Item -LiteralPath $credentialsFile -Force
  }
}
Write-Output 'Workflows importados inativos. Segredo guardado no servidor local e nas credenciais do n8n.'
