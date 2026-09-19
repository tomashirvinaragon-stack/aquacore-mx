# AquaCore MX - Instalador de sincronizacion automatica de inventario
# Ejecutar con Windows PowerShell 5.1 o superior bajo el mismo usuario que usa Excel/Power Query.

$ErrorActionPreference = 'Stop'
$TaskName = 'AquaCore Inventory Sync'
$Root = Join-Path $env:LOCALAPPDATA 'AquaCoreSync'
$ConfigPath = Join-Path $Root 'config.json'
$WorkerPath = Join-Path $Root 'aquacore-inventory-sync.ps1'
$LogPath = Join-Path $Root 'sync.log'

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Stop-WithMessage([string]$Text) {
    Write-Host ""
    Write-Host $Text -ForegroundColor Red
    Write-Host ""
    Read-Host 'Presiona ENTER para cerrar'
    exit 1
}

if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
    Stop-WithMessage 'Este instalador debe ejecutarse en Windows.'
}

New-Item -ItemType Directory -Path $Root -Force | Out-Null

# Limpia una instalación anterior que pudiera haberse quedado ejecutándose.
try {
    Import-Module ScheduledTasks -ErrorAction SilentlyContinue
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    }
} catch {}

# Detiene únicamente workers anteriores de AquaCore que hayan quedado colgados.
try {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*aquacore-inventory-sync.ps1*' } |
        ForEach-Object {
            try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
        }
} catch {}


Write-Host ""
Write-Host "AquaCore MX - Inventario automatico" -ForegroundColor Green
Write-Host "Este proceso NO modifica precios. Solo actualiza existencias." -ForegroundColor Yellow
Write-Host "Usara la misma conexion de Power Query que ya funciona en tu Excel." -ForegroundColor Gray

Write-Step 'Selecciona Herramienta_Sobreinventario_Equipesca_v6.xlsx'
try {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Selecciona la herramienta de Equipesca'
    $dialog.Filter = 'Archivos de Excel (*.xlsx)|*.xlsx'
    $dialog.Multiselect = $false
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        Stop-WithMessage 'No se selecciono ningun archivo.'
    }
    $WorkbookPath = $dialog.FileName
} catch {
    Stop-WithMessage ("No pude abrir el selector de archivo: " + $_.Exception.Message)
}

$DefaultUrl = 'https://aquacore-mx.vercel.app'
Write-Step 'Indica la direccion de tu tienda AquaCore'
$BaseUrl = Read-Host "URL de AquaCore [$DefaultUrl]"
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = $DefaultUrl }
$BaseUrl = $BaseUrl.Trim().TrimEnd('/')

Write-Step 'Escribe la contrasena del panel de inventario de AquaCore'
$SecurePassword = Read-Host 'Contrasena de administrador' -AsSecureString
$EncryptedPassword = ConvertFrom-SecureString -SecureString $SecurePassword

$Worker = @'
param([switch]$Interactive)
$ErrorActionPreference = 'Stop'
$Root = Join-Path $env:LOCALAPPDATA 'AquaCoreSync'
$ConfigPath = Join-Path $Root 'config.json'
$LogPath = Join-Path $Root 'sync.log'

function Log([string]$Message) {
    $line = ('{0:yyyy-MM-dd HH:mm:ss} | {1}' -f (Get-Date), $Message)
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Release-Com($Object) {
    if ($null -ne $Object) {
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Object) } catch {}
    }
}

$excel = $null
$sourceBook = $null
$sourceSheet = $null
$tempBook = $null
$tempSheet = $null
$tempPath = $null

try {
    if (-not (Test-Path $ConfigPath)) { throw 'No existe la configuracion de AquaCoreSync.' }
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json

    if (-not (Test-Path $config.WorkbookPath)) {
        throw ('No encuentro el archivo de Equipesca: ' + $config.WorkbookPath)
    }

    $secure = $config.AdminPassword | ConvertTo-SecureString
    $credential = New-Object System.Management.Automation.PSCredential('aquacore', $secure)
    $adminPassword = $credential.GetNetworkCredential().Password

    Log 'Iniciando Excel.'
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = [bool]$Interactive
    $excel.DisplayAlerts = [bool]$Interactive
    $excel.AskToUpdateLinks = $false

    Log ('Abriendo herramienta: ' + $config.WorkbookPath)
    $sourceBook = $excel.Workbooks.Open($config.WorkbookPath, 0, $true)

    try {
        $sourceSheet = $sourceBook.Worksheets.Item('Productos')
    } catch {
        throw 'No encontre la hoja Productos dentro de la herramienta.'
    }

    Log 'Solicitando RefreshAll de Power Query.'
    $sourceBook.RefreshAll()
    Start-Sleep -Seconds 3

    $deadline = (Get-Date).AddMinutes(4)
    $refreshing = $true
    do {
        $refreshing = $false

        try {
            foreach ($connection in @($sourceBook.Connections)) {
                try {
                    if ($connection.OLEDBConnection.Refreshing) { $refreshing = $true }
                } catch {}
                try {
                    if ($connection.ODBCConnection.Refreshing) { $refreshing = $true }
                } catch {}
                Release-Com $connection
            }
        } catch {}

        try {
            foreach ($lo in @($sourceSheet.ListObjects)) {
                try {
                    if ($lo.QueryTable.Refreshing) { $refreshing = $true }
                } catch {}
                Release-Com $lo
            }
        } catch {}

        try {
            if ($excel.CalculationState -ne 0) { $refreshing = $true }
        } catch {}

        if ($refreshing) { Start-Sleep -Seconds 2 }
    } while ($refreshing -and (Get-Date) -lt $deadline)

    if ($refreshing) {
        throw 'Power Query no termino de actualizar dentro de 4 minutos. Si Excel mostro una ventana, completa el acceso y vuelve a ejecutar el instalador.'
    }

    Log 'Power Query termino de actualizar.'

    $used = $sourceSheet.UsedRange
    $lastRow = $used.Rows.Count
    $lastCol = $used.Columns.Count

    $codeCol = 0
    $descCol = 0
    $stockCol = 0

    for ($c = 1; $c -le [Math]::Min($lastCol, 30); $c++) {
        $header = [string]$sourceSheet.Cells.Item(1, $c).Text
        switch -Regex ($header.Trim()) {
            '^(Codigo|Código)$' { $codeCol = $c; break }
            '^Descripcion$|^Descripción$' { $descCol = $c; break }
            '^Inventario$' { $stockCol = $c; break }
        }
    }

    if (-not $codeCol -or -not $descCol -or -not $stockCol) {
        throw 'No encontre las columnas Codigo, Descripcion e Inventario en la hoja Productos.'
    }

    $tempBook = $excel.Workbooks.Add()
    $tempSheet = $tempBook.Worksheets.Item(1)
    $tempSheet.Name = 'Existencias'
    $tempSheet.Cells.Item(1,1).Value2 = 'Código'
    $tempSheet.Cells.Item(1,2).Value2 = 'Descripción'
    $tempSheet.Cells.Item(1,3).Value2 = 'Total'

    $destRow = 2
    for ($r = 2; $r -le $lastRow; $r++) {
        $code = [string]$sourceSheet.Cells.Item($r, $codeCol).Text
        $desc = [string]$sourceSheet.Cells.Item($r, $descCol).Text
        if ([string]::IsNullOrWhiteSpace($code) -and [string]::IsNullOrWhiteSpace($desc)) { continue }

        $stockValue = $sourceSheet.Cells.Item($r, $stockCol).Value2
        if ($null -eq $stockValue -or $stockValue -eq '') { $stockValue = 0 }

        $tempSheet.Cells.Item($destRow,1).Value2 = $code
        $tempSheet.Cells.Item($destRow,2).Value2 = $desc
        $tempSheet.Cells.Item($destRow,3).Value2 = [double]$stockValue
        $destRow++
    }

    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $tempPath = Join-Path $env:TEMP ("AquaCore_AutoSync_$stamp.xlsx")
    $tempBook.SaveAs($tempPath, 51)
    $tempBook.Close($false)
    Release-Com $tempSheet
    Release-Com $tempBook
    $tempSheet = $null
    $tempBook = $null

    $sourceBook.Close($false)
    Release-Com $used
    Release-Com $sourceSheet
    Release-Com $sourceBook
    $sourceSheet = $null
    $sourceBook = $null

    $excel.Quit()
    Release-Com $excel
    $excel = $null

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()

    $bytes = [IO.File]::ReadAllBytes($tempPath)
    $base64 = [Convert]::ToBase64String($bytes)
    if ($base64.Length -gt 6800000) {
        throw 'El archivo temporal de inventario excede el limite permitido.'
    }

    $payload = @{
        filename = [IO.Path]::GetFileName($tempPath)
        base64 = $base64
    } | ConvertTo-Json -Compress

    $headers = @{ 'x-admin-password' = $adminPassword }
    $url = ($config.BaseUrl.TrimEnd('/') + '/api/admin-inventory-import')
    $result = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -ContentType 'application/json' -Body $payload -TimeoutSec 90

    Log ("OK | productos actualizados: {0} | renglones fuente: {1} | sin coincidencia: {2}" -f $result.updated, $result.reportRows, $result.unmatched)
    Write-Output ("AquaCore actualizado: {0} productos." -f $result.updated)
}
catch {
    Log ('ERROR | ' + $_.Exception.Message)
    Write-Error $_.Exception.Message
    exit 1
}
finally {
    try { if ($tempBook) { $tempBook.Close($false) } } catch {}
    try { if ($sourceBook) { $sourceBook.Close($false) } } catch {}
    try { if ($excel) { $excel.Quit() } } catch {}

    Release-Com $tempSheet
    Release-Com $tempBook
    Release-Com $sourceSheet
    Release-Com $sourceBook
    Release-Com $excel

    if ($tempPath -and (Test-Path $tempPath)) {
        Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
    }

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
'@

Set-Content -Path $WorkerPath -Value $Worker -Encoding UTF8

$config = @{
    WorkbookPath = $WorkbookPath
    BaseUrl = $BaseUrl
    AdminPassword = $EncryptedPassword
    InstalledAt = (Get-Date).ToString('o')
    IntervalMinutes = 15
}
$config | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8

Write-Step 'Preparando la primera sincronizacion'
$runningExcel = @(Get-Process EXCEL -ErrorAction SilentlyContinue)
if ($runningExcel.Count -gt 0) {
    Write-Host ""
    Write-Host "Hay Excel abierto. Guarda tu trabajo y CIERRA todas las ventanas de Excel." -ForegroundColor Yellow
    Write-Host "Cuando ya no tengas Excel abierto, presiona ENTER." -ForegroundColor Yellow
    Read-Host | Out-Null
    if (@(Get-Process EXCEL -ErrorAction SilentlyContinue).Count -gt 0) {
        Stop-WithMessage 'Excel sigue abierto. Cierra Excel por completo y vuelve a ejecutar este instalador.'
    }
}

Write-Step 'Probando la primera sincronizacion'
try {
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $WorkerPath + '" -Interactive'
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -PassThru
    $finished = $process.WaitForExit(330000)
    if (-not $finished) {
        try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
        throw 'La prueba excedio 5 minutos y 30 segundos. Se cancelo para evitar que quede congelada.'
    }
    if ($process.ExitCode -ne 0) {
        $tail = ''
        if (Test-Path $LogPath) {
            $tail = (Get-Content $LogPath -Tail 5 -ErrorAction SilentlyContinue) -join ' | '
        }
        throw ('La prueba de sincronizacion fallo. ' + $tail)
    }
} catch {
    Stop-WithMessage ("No pude completar la primera sincronizacion. Detalle: " + $_.Exception.Message)
}

Write-Step 'Programando Windows para actualizar cada 15 minutos'
try {
    Import-Module ScheduledTasks -ErrorAction Stop
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $WorkerPath)
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(15) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
} catch {
    Stop-WithMessage ("La primera sincronizacion funciono, pero no pude crear la tarea programada: " + $_.Exception.Message)
}

Write-Host ""
Write-Host "LISTO." -ForegroundColor Green
Write-Host "AquaCore actualizara el inventario cada 15 minutos mientras esta PC este encendida y tu sesion de Windows este iniciada." -ForegroundColor White
Write-Host "Los precios NO se modifican." -ForegroundColor Yellow
Write-Host ("Archivo conectado: " + $WorkbookPath) -ForegroundColor Gray
Write-Host ("Registro: " + $LogPath) -ForegroundColor Gray
Write-Host ""
Read-Host 'Presiona ENTER para cerrar'
