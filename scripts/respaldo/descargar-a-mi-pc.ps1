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

    # Carpeta de respaldos DENTRO del servidor. Por defecto la del cron que ya
    # traen muchas instalaciones; respaldar.sh usa ~/respaldos-vocero.
    [string]$CarpetaRemota = '/opt/korex-crm/backups',

    # Copias que se conservan aquí. 0 = no borrar nunca.
    [int]$ConservarDias = 60
)

$ErrorActionPreference = 'Stop'

function Escribir($Texto, $Color = 'White') {
    Write-Host $Texto -ForegroundColor $Color
}

# Un respaldo sano de este CRM pesa decenas de KB. Redondeado a MB salía
# "0 MB", que se lee como archivo vacío justo donde hay que dar confianza.
function Legible([long]$Bytes) {
    if ($Bytes -ge 1GB) { return "{0:N1} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N1} MB" -f ($Bytes / 1MB) }
    return "{0:N0} KB" -f ([math]::Max(1, $Bytes / 1KB))
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

# Los respaldos que ya hay aquí, en cualquiera de los dos formatos. Un -Filter
# solo admite un patrón, y con .dump a secas se perderían los .sql.gz — que en
# la mayoría de instalaciones son justamente los que hay.
function RespaldosLocales {
    Get-ChildItem -Path $Destino -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(vocero[-_]|volumenes-).+\.(dump|sql\.gz|tar\.gz)$' }
}

# --- Qué hay en el servidor ------------------------------------------------

Escribir "-> Conectando con $Servidor ..." 'Cyan'

# Huella y nombre de cada respaldo, en una sola conexión. Cubre lo que puede
# haber en la carpeta: volcados de Postgres en sus dos formatos (.dump y
# .sql.gz) y los paquetes de volúmenes Docker (.tar.gz), donde viven las bases
# SQLite de los bots y las sesiones de WhatsApp.
$comando = "cd '$CarpetaRemota' 2>/dev/null && sha256sum vocero_*.dump vocero-*.sql.gz vocero_*.sql.gz volumenes-*.tar.gz 2>/dev/null || true"
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
    if ("$linea" -match '^([0-9a-f]{64})\s+((?:vocero[-_]|volumenes-).+?\.(?:dump|sql\.gz|tar\.gz))$') {
        $remotos += [pscustomobject]@{ Huella = $Matches[1]; Nombre = $Matches[2] }
    }
}

if ($remotos.Count -eq 0) {
    Escribir "No hay ningun respaldo en $CarpetaRemota del servidor." 'Yellow'
    Escribir "Comprueba la ruta con:  ssh $Servidor 'ls $CarpetaRemota'" 'Yellow'
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
    & scp -q -o BatchMode=yes "${Servidor}:$CarpetaRemota/$($item.Nombre)" $local 2>&1 | Out-Null

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

    $peso = Legible (Get-Item $local).Length
    Escribir "   OK  $($item.Nombre)  ($peso, huella verificada)" 'Green'
    Anotar "Descargado y verificado: $($item.Nombre) ($peso)"
    $traidos++
}

# --- Limpieza local --------------------------------------------------------

if ($ConservarDias -gt 0) {
    $limite = (Get-Date).AddDays(-$ConservarDias)
    # Nunca se toca el más reciente, aunque sea antiguo: si el servidor lleva
    # meses sin respaldar, esa copia vieja es lo unico que hay.
    $locales = RespaldosLocales | Sort-Object LastWriteTime -Descending
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

$total = (RespaldosLocales | Measure-Object).Count
$sumaBytes = (RespaldosLocales | Measure-Object -Property Length -Sum).Sum
$pesoTotal = if ($sumaBytes) { Legible $sumaBytes } else { '0 KB' }

Escribir ""
if ($fallidos -gt 0) {
    Escribir "TERMINADO CON FALLOS: $traidos nueva(s), $fallidos fallida(s)." 'Red'
} else {
    Escribir "LISTO: $traidos nueva(s), $yaEstaban ya estaban." 'Green'
}
Escribir "Tienes $total copia(s) aqui ($pesoTotal): $Destino"
Anotar "Resumen: $traidos nuevas, $yaEstaban existentes, $fallidos fallidas, $total en total"

if ($fallidos -gt 0) { exit 1 }
