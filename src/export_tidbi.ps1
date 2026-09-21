<#
Export the TIDBI base.mdb to CSV.

TIDBI ("Torchlight Item DataBase International") is a 2014 third-party item
viewer. Its base.mdb is a Jet 4 (Access 2000/2003) database and is by far the
easiest source of structured Torchlight II item stats -- it already contains
the numbers that are locked in the binary field section of the game's own .DAT
files. See REFERENCE.md section 5 for what it does and does not cover.

No installs are needed: Python has no MDB reader on this machine and mdbtools
is absent, but Microsoft's ACE OLEDB provider is registered, so .NET's
System.Data.OleDb reads it directly. (pip install pyodbc would work through the
same driver if you ever want it from Python.)

Usage:
    powershell -File export_tidbi.ps1
    powershell -File export_tidbi.ps1 -Mdb "D:\path\base.mdb" -OutDir .\csv

Both defaults are relative to this script, not to the caller's directory: the
database is research material under test/, and the CSVs it writes are a build
input under data/. Neither reads the build; this only regenerates data/csv
when the archive is re-exported.
#>
param(
    [string]$Mdb    = (Join-Path $PSScriptRoot "..\test\tidbi\base.mdb"),
    [string]$OutDir = (Join-Path $PSScriptRoot "..\data\csv")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Mdb)) { throw "database not found: $Mdb" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# ACE is the modern provider; Jet 4.0 is the fallback if ACE is absent.
$providers = @("Microsoft.ACE.OLEDB.12.0", "Microsoft.ACE.OLEDB.16.0",
               "Microsoft.Jet.OLEDB.4.0")
$conn = $null
foreach ($p in $providers) {
    try {
        $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=$p;Data Source=$Mdb;")
        $conn.Open()
        Write-Output "connected via $p"
        break
    } catch {
        $conn = $null
    }
}
if ($null -eq $conn) { throw "no Access OLEDB provider could open $Mdb" }

# QItems is a saved *query*, not a table, so it has to be named explicitly --
# enumerating tables alone misses it. It returns the same 6,050 rows as `items`
# (verified: 0 differing cells across all 47 shared columns) plus six computed
# DPS columns the table has no field for: DPS_ALL and one per damage type. Those
# are TIDBI's own dps figures, and this project does not use them -- they round
# each damage type and then add, where the game rounds once (see REFERENCE.md
# section 7, "Damage per second"). Exporting them anyway keeps it checkable
# instead of invisible, which is exactly how "TIDBI says 182" becomes a question
# nobody can answer.
foreach ($t in @("items", "QItems", "effects", "sets", "SetsSpisok")) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT * FROM [$t]"
    $dt = New-Object System.Data.DataTable
    $dt.Load($cmd.ExecuteReader())
    $dest = Join-Path $OutDir "$t.csv"
    $dt | Export-Csv -Path $dest -NoTypeInformation -Encoding UTF8
    Write-Output ("{0,-12} {1,6} rows -> {2}" -f $t, $dt.Rows.Count, $dest)
}

$conn.Close()
Write-Output ""
Write-Output "note: effects.item joins to items.ConsolNAME (a unit name such as"
Write-Output "      'crossbow_m01slots'), NOT to items.id. Quoting the key matters."
