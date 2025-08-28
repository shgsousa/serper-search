# Serper Search MCP Server - Kubernetes Deployment

This directory contains Kubernetes manifests to deploy the Serper Search MCP Server in your cluster.

## Prerequisites

- Kubernetes cluster (1.21+)
- kubectl configured to access your cluster
- NGINX Ingress Controller installed
- Docker image built and available in your cluster

## Quick Start

### Option 1: PowerShell (Windows)
```powershell
# Quick deployment (builds and deploys)
.\k8s\deploy.ps1

# Or step by step:
# 1. Build image
.\k8s\build-image.ps1 -Registry "your-registry.com"

# 2. Deploy to cluster
.\k8s\quick-deploy.ps1

# Advanced deployment with options
.\k8s\deploy.ps1 -Registry "your-registry.com" -Tag "v1.0" -Namespace "production"
```

### Option 2: Bash (Linux/Mac)
```bash
# Build and push the image
docker build -t web-search-mcp:latest .
docker tag web-search-mcp:latest your-registry/web-search-mcp:latest
docker push your-registry/web-search-mcp:latest

# Deploy to Kubernetes
chmod +x k8s/deploy.sh
./k8s/deploy.sh
```

### Option 3: Manual Deployment

```bash
# Apply in order
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

## Configuration

### Environment Variables (ConfigMap)
- `SEARCH_RATE_LIMIT_MS`: Rate limiting in milliseconds (default: 500)
- `PORT`: Server port (default: 3000)
- `MCP_HTTP_MODE`: Enable HTTP mode (default: true)

### Secrets
- `SERPER_API_KEY`: Your Serper API key (stored in Secret)

### Scaling
- **Replicas**: 2 (configured in deployment)
- **Resources**: 128Mi-512Mi memory, 100m-500m CPU

## Access

### Internal (within cluster)
```
http://web-search-mcp-service.default.svc.cluster.local
```

### External (via Ingress)
```
http://web-search-mcp.local
```

Add to your `/etc/hosts` or DNS:
```
<INGRESS_IP> web-search-mcp.local
```

## Testing

```bash
# Health check
curl http://web-search-mcp.local/health

# Search test
curl -X POST http://web-search-mcp.local/search \
  -H "Content-Type: application/json" \
  -d '{"query": "artificial intelligence", "limit": 2}'
```

## Monitoring

```bash
# Check deployment status
kubectl get deployments
kubectl get pods -l app=web-search-mcp

# View logs
kubectl logs -l app=web-search-mcp -f

# Check service endpoints
kubectl get endpoints web-search-mcp-service
```

## Cleanup

```bash
# Remove all components
kubectl delete -f k8s/
```

## Security Features

- ✅ Non-root container execution
- ✅ Read-only root filesystem
- ✅ Security contexts applied
- ✅ Secrets management for API keys

## PowerShell Scripts (Windows)

### `deploy.ps1` - Full Deployment Script
Advanced deployment script with comprehensive options:

```powershell
# Basic deployment
.\deploy.ps1

# Deploy to specific namespace with custom registry
.\deploy.ps1 -Namespace "production" -Registry "myregistry.com" -Tag "v1.0"

# Build only (don't deploy)
.\deploy.ps1 -BuildOnly -Registry "myregistry.com"

# Deploy without building (use existing image)
.\deploy.ps1 -SkipBuild

# Remove deployment
.\deploy.ps1 -Remove

# Help
Get-Help .\deploy.ps1 -Full
```

### `build-image.ps1` - Build Docker Image
```powershell
# Build locally
.\build-image.ps1

# Build and push to registry
.\build-image.ps1 -Registry "myregistry.com" -Tag "v1.0"

# Build without pushing
.\build-image.ps1 -Registry "myregistry.com" -NoPush
```

### `quick-deploy.ps1` - Simple Deployment
```powershell
# Quick deployment (assumes image already exists)
.\quick-deploy.ps1
```

## Files

- `configmap.yaml`: Application configuration
- `secret.yaml`: Sensitive data (API keys)
- `deployment.yaml`: Main application deployment
- `service.yaml`: Internal service exposure
- `ingress.yaml`: External access via NGINX Ingress
- `deploy.sh`: Automated deployment script (Bash)
- `deploy.ps1`: Advanced deployment script (PowerShell)
- `build-image.ps1`: Docker image build script (PowerShell)
- `quick-deploy.ps1`: Simple deployment script (PowerShell)
