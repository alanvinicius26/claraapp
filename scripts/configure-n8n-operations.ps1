param([string]$Docker = 'C:/Users/Alan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe', [string]$ProjectId = 'HvuMHDLU0Bfw59Ms')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
# Uses the existing local credential. Official credential must be configured separately.
foreach($name in @('clara-atendimento.local.json','clara-atendimento.oficial.json')) {
  & $Docker cp (Join-Path $projectRoot ('integrations/n8n/'+$name)) ('n8n:/tmp/'+$name)
  if($LASTEXITCODE -ne 0){throw 'Não foi possível copiar o workflow.'}
  & $Docker exec -u node n8n n8n import:workflow ('--input=/tmp/'+$name) ('--projectId='+$ProjectId)
  if($LASTEXITCODE -ne 0){throw 'Não foi possível importar o workflow.'}
}
Write-Output 'Fluxos completos importados inativos. Configure o ambiente antes de publicar.'
