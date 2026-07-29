<#
    Trae los respaldos del servidor a este computador (Windows).

    Un respaldo que vive en el mismo disco que la base no protege de que el
    servidor desaparezca, y sacarlo a un almacenamiento en la nube exige una
    tarjeta que no siempre se tiene. Esta es la vía sin tarjeta: el computador
    va a buscar las copias. Al revés no funcionaría — un PC doméstico no tiene
    dirección fija en internet y se apaga por las noches.

    Cada archivo se verifica por huella SHA-256 contra el original del
    servidor: una descarga cortada a la mitad pesa distinto pero se abre igual,
    y esa clase de copia solo se descubre rota el día que hace falta.

    Uso:
      .\descargar-a-mi-pc.ps1 -Servidor usuario@1.2.3.4

    Para que corra sola, ver docs/respaldos.md → "Que se haga sola".
#>

[CmdletBinding()]
param(
    # usuario@servidor, tal como lo escribirías en ssh.
    [Parameter(Mandatory = $true)]
    [string]$Servidor,

    # Dónde dejarlos. Por defecto, una carpeta en el Escritorio.
    [string]$Destino = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Respaldos Vocero'),

    # Carpeta de respaldos DENTRO del servidor (la que usa respaldar.sh).
    [string]$CarpetaRemota = 'respaldos-vocero',

    # Copias que se conservan aquí. 0 = no borrar nunca.
    [int]$ConservarDias = 60
)

$ErrorActionPreference = 'Stop'

function Escribir($Texto, $Color = 'White') {
    Write-Host $Texto -ForegroundColor $Color
}

# --- Comprobaciones previas ------------------------------------------------

foreach ($herramienta in @('ssh', 'scp')) {
    if (-not (Get-Command $herramienta -ErrorAction SilentlyContinue)) {
        Escribir "ERROR: no encuentro '$herramienta' en este equipo." 'Red'
        Escribir "Actívalo en: Configuracion > Aplicaciones > Caracteristicas opcionales" 'Yellow'
        Escribir "  > Agregar caracteristica > 'Cliente OpenSSH'." 'Yellow'
        exit 1
    }
}

if (-not (Test-Path $Destino)) {
    New-Item -ItemType Directory -Path $Destino -Force | Out-Null
    Escribir "Carpeta creada: $Destino" 'DarkGray'
}

$registro = Join-Path $Destino 'registro.txt'
function Anotar($Texto) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Texto" |
        Add-Content -Path $registro -Encoding utf8
}

# --- Qué hay en el servidor ------------------------------------------------

Escribir "-> Conectando con $Servidor ..." 'Cyan'

# Huella y nombre de cada respaldo, en una sola conexión.
$comando = "cd ~/$CarpetaRemota 2>/dev/null && sha256sum vocero_*.dump 2>/dev/null || true"
$listado = & ssh -o BatchMode=yes -o ConnectTimeout=20 $Servidor $comando 2>&1

if ($LASTEXITCODE -ne 0) {
    Escribir "ERROR: no se pudo conectar al servidor." 'Red'
    Escribir "$listado" 'DarkGray'
    Escribir ""
    Escribir "Lo mas comun: la clave SSH todavia no esta puesta, y por eso pide" 'Yellow'
    Escribir "contrasena (con -BatchMode no puede). Ver docs/respaldos.md." 'Yellow'
    Anotar "FALLO de conexion con $Servidor"
    exit 1
}

$remotos = @()
foreach ($linea in $listado) {
    # Formato de sha256sum: "<huella>  <archivo>"
    if ("$linea" -match '^([0-9a-f]{64})\s+(vocero_.+\.dump)$') {
        $remotos += [pscustomobject]@{ Huella = $Matches[1]; Nombre = $Matches[2] }
    }
}

if ($remotos.Count -eq 0) {
    Escribir "No hay ningun respaldo en ~/$CarpetaRemota del servidor." 'Yellow'
    Escribir "Corre alli primero:  ./scripts/respaldo/respaldar.sh" 'Yellow'
    Anotar "Sin respaldos que traer"
    exit 1
}

Escribir "   $($remotos.Count) respaldo(s) en el servidor." 'DarkGray'

# --- Descargar lo que falte ------------------------------------------------

$traidos = 0
$yaEstaban = 0
$fallidos = 0

foreach ($item in $remotos) {
    $local = Join-Path $Destino $item.Nombre

    if (Test-Path $local) {
        # Ya está: se comprueba que sea el mismo y no una descarga a medias.
        $huellaLocal = (Get-FileHash -Path $local -Algorithm SHA256).Hash.ToLower()
        if ($huellaLocal -eq $item.Huella) {
            $yaEstaban++
            continue
        }
        Escribir "   $($item.Nombre) estaba incompleto: se baja de nuevo." 'Yellow'
        Remove-Item $local -Force
    }

    Escribir "-> Trayendo $($item.Nombre) ..." 'Cyan'
    & scp -q -o BatchMode=yes "${Servidor}:~/$CarpetaRemota/$($item.Nombre)" $local 2>&1 | Out-Null

    if (-not (Test-Path $local)) {
        Escribir "   FALLO al descargar $($item.Nombre)" 'Red'
        Anotar "FALLO al descargar $($item.Nombre)"
        $fallidos++
        continue
    }

    $huellaLocal = (Get-FileHash -Path $local -Algorithm SHA256).Hash.ToLower()
    if ($huellaLocal -ne $item.Huella) {
        # Un archivo corrupto es peor que ninguno: da falsa tranquilidad.
        Escribir "   La copia llego danada: se descarta." 'Red'
        Remove-Item $local -Force
        Anotar "CORRUPTO al descargar $($item.Nombre)"
        $fallidos++
        continue
    }

    $mb = [math]::Round((Get-Item $local).Length / 1MB, 1)
    Escribir "   OK  $($item.Nombre)  ($mb MB, huella verificada)" 'Green'
    Anotar "Descargado y verificado: $($item.Nombre) ($mb MB)"
    $traidos++
}

# --- Limpieza local --------------------------------------------------------

if ($ConservarDias -gt 0) {
    $limite = (Get-Date).AddDays(-$ConservarDias)
    # Nunca se toca el más reciente, aunque sea antiguo: si el servidor lleva
    # meses sin respaldar, esa copia vieja es lo unico que hay.
    $locales = Get-ChildItem -Path $Destino -Filter 'vocero_*.dump' |
        Sort-Object LastWriteTime -Descending
    $viejos = $locales | Select-Object -Skip 1 | Where-Object { $_.LastWriteTime -lt $limite }
    foreach ($v in $viejos) {
        Remove-Item $v.FullName -Force
        Anotar "Borrado por antiguedad: $($v.Name)"
    }
    if ($viejos.Count -gt 0) {
        Escribir "   ($($viejos.Count) copia(s) de mas de $ConservarDias dias borradas)" 'DarkGray'
    }
}

# --- Resumen ---------------------------------------------------------------

$total = (Get-ChildItem -Path $Destino -Filter 'vocero_*.dump' | Measure-Object).Count
$peso = (Get-ChildItem -Path $Destino -Filter 'vocero_*.dump' |
    Measure-Object -Property Length -Sum).Sum
$pesoMb = if ($peso) { [math]::Round($peso / 1MB, 1) } else { 0 }

Escribir ""
if ($fallidos -gt 0) {
    Escribir "TERMINADO CON FALLOS: $traidos nueva(s), $fallidos fallida(s)." 'Red'
} else {
    Escribir "LISTO: $traidos nueva(s), $yaEstaban ya estaban." 'Green'
}
Escribir "Tienes $total copia(s) aqui ($pesoMb MB): $Destino"
Anotar "Resumen: $traidos nuevas, $yaEstaban existentes, $fallidos fallidas, $total en total"

if ($fallidos -gt 0) { exit 1 }
