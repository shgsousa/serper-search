# Quick Deploy Script for Serper Search MCP Server
# Simple PowerShell script for basic deployment

Write-Host "🚀 Quick Deploy - Serper Search MCP Server" -ForegroundColor Magenta
Write-Host ""

# Check if kubectl is available
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
    Write-Host "❌ kubectl not found. Please install kubectl first." -ForegroundColor Red
    exit 1
}

# Check cluster connection
try {
    kubectl cluster-info | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Cannot connect to Kubernetes cluster" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Cannot connect to Kubernetes cluster" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Connected to Kubernetes cluster" -ForegroundColor Green

# Deploy all resources
$resources = @(
    "configmap.yaml",
    "secret.yaml", 
    "deployment.yaml",
    "service.yaml",
    "ingress.yaml"
)

foreach ($resource in $resources) {
    $filePath = "k8s\$resource"
    if (Test-Path $filePath) {
        Write-Host "📦 Applying $resource..." -ForegroundColor Cyan
        kubectl apply -f $filePath -n mcp-servers
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Applied $resource" -ForegroundColor Green
        } else {
            Write-Host "❌ Failed to apply $resource" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "⚠️ File not found: $filePath" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "⏳ Waiting for deployment..." -ForegroundColor Cyan
kubectl wait --for=condition=available --timeout=300s deployment/serper-search -n mcp-servers

Write-Host ""
Write-Host "📋 Deployment Status:" -ForegroundColor Blue
kubectl get pods -l app=serper-search -n mcp-servers
kubectl get service serper-search-service -n mcp-servers
kubectl get ingress serper-search-ingress -n mcp-servers

Write-Host ""
Write-Host "🎉 Deployment completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Test with:" -ForegroundColor Cyan
Write-Host "curl http://serper-search.homelab.local/health" -ForegroundColor Gray
