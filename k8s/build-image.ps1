# Build and Push Docker Image for Serper Search MCP Server
param(
    [Parameter(Mandatory=$false, HelpMessage="Docker registry URL (e.g., your-registry.com)")]
    [string]$Registry = "shgsousa",
    
    [Parameter(Mandatory=$false, HelpMessage="Image tag")]
    [string]$Tag = "latest",
    
    [Parameter(Mandatory=$false, HelpMessage="Skip pushing to registry")]
    [switch]$NoPush,
    
    [Parameter(Mandatory=$false, HelpMessage="Platform for multi-arch builds")]
    [string]$Platform = ""
)

Write-Host "🔨 Building Serper Search MCP Server Docker Image" -ForegroundColor Magenta
Write-Host ""

# Check if Docker is available
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker not found. Please install Docker first." -ForegroundColor Red
    exit 1
}

# Check if Docker daemon is running
try {
    docker info | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Docker daemon is not running" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Docker daemon is not running" -ForegroundColor Red
    exit 1
}

# Determine image name
$imageName = if ($Registry) {
    "$Registry/serper-search:$Tag"
} else {
    "serper-search:$Tag"
}

Write-Host "Image name: $imageName" -ForegroundColor Cyan
Write-Host ""

# Build the image
Write-Host "🔨 Building Docker image..." -ForegroundColor Cyan

$buildArgs = @("build", "-t", $imageName, ".")

if ($Platform) {
    $buildArgs += @("--platform", $Platform)
}

& docker @buildArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker build failed" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Docker build completed" -ForegroundColor Green

# Push to registry if specified and not skipped
if ($Registry -and -not $NoPush) {
    Write-Host ""
    Write-Host "📤 Pushing image to registry..." -ForegroundColor Cyan
    
    docker push $imageName
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Docker push failed" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ Image pushed successfully" -ForegroundColor Green
} elseif (-not $Registry) {
    Write-Host ""
    Write-Host "ℹ️ No registry specified, image built locally only" -ForegroundColor Blue
} elseif ($NoPush) {
    Write-Host ""
    Write-Host "ℹ️ Push skipped (NoPush flag set)" -ForegroundColor Blue
}

# Update deployment.yaml if it exists
$deploymentPath = "k8s\deployment.yaml"
if (Test-Path $deploymentPath) {
    Write-Host ""
    Write-Host "📝 Updating deployment.yaml..." -ForegroundColor Cyan
    
    $content = Get-Content $deploymentPath -Raw
    $content = $content -replace "image: .*", "        image: $imageName"
    Set-Content -Path $deploymentPath -Value $content -NoNewline
    
    Write-Host "✅ Updated deployment.yaml with new image" -ForegroundColor Green
}

Write-Host ""
Write-Host "🎉 Build process completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Deploy to Kubernetes: .\k8s\quick-deploy.ps1" -ForegroundColor Gray
Write-Host "2. Or use full deployment: .\k8s\deploy.ps1 -SkipBuild" -ForegroundColor Gray
