# Converts a presentation to PDF with the installed Microsoft PowerPoint.
# Usage: powershell -File pptx_to_pdf.ps1 -In <presentation> -Out <file.pdf>
param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = "Stop"

$app = New-Object -ComObject PowerPoint.Application
try {
  # Open(FileName, ReadOnly = true, Untitled = false, WithWindow = false)
  $pres = $app.Presentations.Open($In, -1, 0, 0)
  try {
    $pres.SaveAs($Out, 32)  # 32 = ppSaveAsPDF
  } finally {
    $pres.Close()
  }
} finally {
  # Leave PowerPoint running if the user has their own presentations open.
  if ($app.Presentations.Count -eq 0) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
