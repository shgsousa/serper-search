# Serper Search MCP Server - Kubernetes Deployment Script (PowerShell)
# Author: Generated for serper-search project
# Description: Deploy Serper Search MCP Server to Kubernetes cluster using PowerShell

param(
    [Parameter(HelpMessage="Namespace to deploy to")]
    [string]$Namespace = "mcp-servers",
    
    [Parameter(HelpMessage="Docker registry for the image")]
    [string]$Registry = "",
    
    [Parameter(HelpMessage="Image tag to deploy")]
    [string]$Tag = "latest",
    
    [Parameter(HelpMessage="Skip image build and push")]
    [switch]$SkipBuild,
    
    [Parameter(HelpMessage="Only build and push, don't deploy")]
    [switch]$BuildOnly,
    
    [Parameter(HelpMessage="Remove deployment instead of deploying")]
    [switch]$Remove,
    
    [Parameter(HelpMessage="Show verbose output")]
    [switch]$Verbose
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Colors for output
$Colors = @{
    Green = "Green"
    Red = "Red"
    Yellow = "Yellow"
    Cyan = "Cyan"
    Blue = "Blue"
    Magenta = "Magenta"
}

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White",
        [string]$Prefix = ""
    )
    
    if ($Prefix) {
        Write-Host "$Prefix " -ForegroundColor $Color -NoNewline
        Write-Host $Message
    } else {
        Write-Host $Message -ForegroundColor $Color
    }
}

function Test-Command {
    param([string]$Command)
    return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Test-KubernetesConnection {
    try {
        kubectl cluster-info 2>$null | Out-Null
        return $?
    } catch {
        return $false
    }
}

function Build-And-Push-Image {
    param(
        [string]$Registry,
        [string]$Tag
    )
    
    Write-ColorOutput "🔨 Building Docker image..." $Colors.Cyan "INFO"
    
    # Build the image
    $imageName = if ($Registry) { "$Registry/serper-search:$Tag" } else { "serper-search:$Tag" }
    
    Write-ColorOutput "Building image: $imageName" $Colors.Blue
    docker build -t $imageName . 2>&1 | Tee-Object -Variable buildOutput | Write-Host
    
    if ($LASTEXITCODE -ne 0) {
        Write-ColorOutput "❌ Docker build failed" $Colors.Red "ERROR"
        exit 1
    }
    
    if ($Registry) {
        Write-ColorOutput "📤 Pushing image to registry..." $Colors.Cyan "INFO"
        docker push $imageName 2>&1 | Tee-Object -Variable pushOutput | Write-Host
        
        if ($LASTEXITCODE -ne 0) {
            Write-ColorOutput "❌ Docker push failed" $Colors.Red "ERROR"
            exit 1
        }
    }
    
    Write-ColorOutput "✅ Image build completed: $imageName" $Colors.Green "SUCCESS"
    return $imageName
}

function Update-Deployment-Image {
    param(
        [string]$ImageName,
        [string]$Namespace
    )
    
    $deploymentPath = "k8s\deployment.yaml"
    
    if (Test-Path $deploymentPath) {
        Write-ColorOutput "📝 Updating deployment image..." $Colors.Cyan "INFO"
        
        # Read the deployment file
        $content = Get-Content $deploymentPath -Raw
        
        # Replace the image line
        $content = $content -replace "image: .*", "        image: $ImageName"
        
        # Write back to file
        Set-Content -Path $deploymentPath -Value $content -NoNewline
        
        Write-ColorOutput "✅ Updated deployment.yaml with image: $ImageName" $Colors.Green "SUCCESS"
    }
}

function Deploy-Kubernetes-Resources {
    param([string]$Namespace)
    
    Write-ColorOutput "🚀 Deploying Serper Search MCP Server to Kubernetes..." $Colors.Magenta "DEPLOY"
    
    # Array of resources in deployment order
    $resources = @(
        @{File="configmap.yaml"; Name="ConfigMap"},
        @{File="secret.yaml"; Name="Secret"},
        @{File="deployment.yaml"; Name="Deployment"},
        @{File="service.yaml"; Name="Service"},
        @{File="ingress.yaml"; Name="Ingress"}
    )
    
    foreach ($resource in $resources) {
        $filePath = "k8s\$($resource.File)"
        
        if (Test-Path $filePath) {
            Write-ColorOutput "📦 Applying $($resource.Name)..." $Colors.Cyan "INFO"
            
            kubectl apply -f $filePath -n $Namespace 2>&1 | Write-Host
            
            if ($LASTEXITCODE -ne 0) {
                Write-ColorOutput "❌ Failed to apply $($resource.Name)" $Colors.Red "ERROR"
                exit 1
            }
            
            Write-ColorOutput "✅ Applied $($resource.Name)" $Colors.Green "SUCCESS"
        } else {
            Write-ColorOutput "⚠️ File not found: $filePath" $Colors.Yellow "WARN"
        }
    }
    
    # Wait for deployment to be ready
    Write-ColorOutput "⏳ Waiting for deployment to be ready..." $Colors.Cyan "INFO"
    
    $waitCmd = "kubectl wait --for=condition=available --timeout=300s deployment/serper-search -n $Namespace"
    
    Invoke-Expression $waitCmd 2>&1 | Write-Host
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput "✅ Deployment completed successfully!" $Colors.Green "SUCCESS"
    } else {
        Write-ColorOutput "⚠️ Deployment may not be fully ready, but resources were applied" $Colors.Yellow "WARN"
    }
}

function Remove-Kubernetes-Resources {
    param([string]$Namespace)
    
    Write-ColorOutput "🗑️ Removing Serper Search MCP Server from Kubernetes..." $Colors.Red "REMOVE"
    
    kubectl delete -f k8s\ -n $Namespace 2>&1 | Write-Host
    
    Write-ColorOutput "✅ Resources removed successfully!" $Colors.Green "SUCCESS"
}

function Show-Deployment-Status {
    param([string]$Namespace)
    
    $nsFlag = "-n $Namespace"
    
    Write-ColorOutput "`n📋 Deployment Status:" $Colors.Magenta "STATUS"
    Write-Host ""
    
    Write-ColorOutput "Pods:" $Colors.Cyan
    Invoke-Expression "kubectl get pods -l app=serper-search $nsFlag" | Write-Host
    
    Write-Host ""
    Write-ColorOutput "Service:" $Colors.Cyan
    Invoke-Expression "kubectl get service serper-search-service $nsFlag" | Write-Host
    
    Write-Host ""
    Write-ColorOutput "Ingress:" $Colors.Cyan
    Invoke-Expression "kubectl get ingress serper-search-ingress $nsFlag" | Write-Host
}

function Show-Usage-Instructions {
    Write-Host ""
    Write-ColorOutput "🔍 Testing Instructions:" $Colors.Blue "INFO"
    Write-Host ""
    Write-Host "Health Check:"
    Write-Host "  curl http://serper-search.homelab.local/health" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Search Test:"
    Write-Host "  curl -X POST http://serper-search.homelab.local/search ``" -ForegroundColor Gray
    Write-Host "    -H `"Content-Type: application/json`" ``" -ForegroundColor Gray
    Write-Host "    -d '{`"query`": `"test`", `"limit`": 2}'" -ForegroundColor Gray
    Write-Host ""
    Write-Host "PowerShell Test:"
    Write-Host "  `$result = Invoke-RestMethod -Uri 'http://serper-search.homelab.local/search' ``" -ForegroundColor Gray
    Write-Host "    -Method POST -ContentType 'application/json' ``" -ForegroundColor Gray
    Write-Host "    -Body '{`"query`": `"test`", `"limit`": 2}'" -ForegroundColor Gray
    Write-Host ""
    Write-ColorOutput "📊 Monitoring Commands:" $Colors.Blue "INFO"
    Write-Host ""
    Write-Host "Check logs:"
    Write-Host "  kubectl logs -l app=serper-search -f" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Scale deployment:"
    Write-Host "  kubectl scale deployment serper-search --replicas=5" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Remove deployment:"
    Write-Host "  .\k8s\deploy.ps1 -Remove" -ForegroundColor Gray
}

# Main execution
try {
    Write-ColorOutput "🌟 Serper Search MCP Server - Kubernetes Deployment" $Colors.Magenta "DEPLOY"
    Write-Host "Namespace: $Namespace" -ForegroundColor Gray
    Write-Host ""
    
    # Check prerequisites
    Write-ColorOutput "🔍 Checking prerequisites..." $Colors.Cyan "INFO"
    
    if (-not (Test-Command "kubectl")) {
        Write-ColorOutput "❌ kubectl is not installed or not in PATH" $Colors.Red "ERROR"
        Write-Host "Please install kubectl: https://kubernetes.io/docs/tasks/tools/"
        exit 1
    }
    
    if (-not (Test-Command "docker") -and -not $SkipBuild) {
        Write-ColorOutput "❌ docker is not installed or not in PATH" $Colors.Red "ERROR"
        Write-Host "Please install Docker or use -SkipBuild flag"
        exit 1
    }
    
    if (-not (Test-KubernetesConnection)) {
        Write-ColorOutput "❌ Cannot connect to Kubernetes cluster" $Colors.Red "ERROR"
        Write-Host "Please check your kubectl configuration"
        exit 1
    }
    
    Write-ColorOutput "✅ Prerequisites check passed" $Colors.Green "SUCCESS"
    
    # Handle removal
    if ($Remove) {
        Remove-Kubernetes-Resources -Namespace $Namespace
        exit 0
    }
    
    # Build and push image if needed
    if (-not $SkipBuild) {
        $imageName = Build-And-Push-Image -Registry $Registry -Tag $Tag
        Update-Deployment-Image -ImageName $imageName -Namespace $Namespace
        
        if ($BuildOnly) {
            Write-ColorOutput "✅ Build completed. Use -SkipBuild flag to deploy." $Colors.Green "SUCCESS"
            exit 0
        }
    }
    
    # Deploy resources
    Deploy-Kubernetes-Resources -Namespace $Namespace
    
    # Show status
    Show-Deployment-Status -Namespace $Namespace
    
    # Show usage instructions
    Show-Usage-Instructions
    
} catch {
    Write-ColorOutput "❌ An error occurred: $($_.Exception.Message)" $Colors.Red "ERROR"
    if ($Verbose) {
        Write-Host $_.ScriptStackTrace -ForegroundColor Red
    }
    exit 1
}
