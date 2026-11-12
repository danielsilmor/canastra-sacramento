param(
  [string]$Arquivo = '',     # histórico baixado no jogo (.json); vazio = o mais recente da pasta Downloads
  [string]$Modo = 'lista',   # lista (uma linha por jogada) | texto (situação da mesa) | conferir (situação + análise)
  [string]$Jogadas = '',     # ex.: 37  |  30-40  |  12,37,50  |  marcadas   (vazio = todas)
  [int]$Partida = 0,         # 0 = partida mais recente do arquivo, 1 = a anterior
  [int]$Mundos = 1500        # mundos por opção ao conferir (mais = mais preciso e mais lento)
)
# Lê o histórico gravado pelo jogo e mostra/confere as jogadas pela página analise.html,
# usando o Edge sem janela. Exemplo:
#   powershell -File ferramentas\analisar.ps1 -Modo conferir -Jogadas marcadas
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Arquivo) {
  $ultimo = Get-ChildItem "$env:USERPROFILE\Downloads\canastra-historico-*.json" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $ultimo) { Write-Output 'Nenhum histórico (canastra-historico-*.json) na pasta Downloads.'; exit 1 }
  $Arquivo = $ultimo.FullName
}
$json = [IO.File]::ReadAllText($Arquivo, [Text.Encoding]::UTF8)
try { $null = $json | ConvertFrom-Json } catch { Write-Output "O arquivo não é um histórico válido: $Arquivo"; exit 1 }

# A página carrega os dados como script (assim funciona direto do disco, sem servidor).
$tmp = Join-Path $env:TEMP 'canastra-analise'
New-Item -ItemType Directory -Force $tmp | Out-Null
[IO.File]::WriteAllText("$tmp\dados.js", "var DADOS_HISTORICO = $json;", (New-Object Text.UTF8Encoding $false))

$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" }
$page = ([Uri](Join-Path $raiz 'analise.html')).AbsoluteUri
$dados = ([Uri]"$tmp\dados.js").AbsoluteUri
$url = "$page`?auto=1&modo=$Modo&partida=$Partida&mundos=$Mundos&jogadas=$Jogadas&dados=" + [Uri]::EscapeDataString($dados)
$o = & $edge --headless=new --disable-gpu --allow-file-access-from-files --user-data-dir="$tmp\perfil" --dump-dom $url 2>$null | Out-String
Write-Output "Arquivo: $Arquivo"
Write-Output ([Net.WebUtility]::HtmlDecode([regex]::Match($o, '<pre id="result">(.*?)</pre>', 'Singleline').Groups[1].Value))
