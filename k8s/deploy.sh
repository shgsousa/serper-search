#!/bin/bash

# Web Search MCP Server - Kubernetes Deployment Script

set -e

echo "🚀 Deploying Web Search MCP Server to Kubernetes..."

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH"
    exit 1
fi

# Check if we can connect to the cluster
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster"
    exit 1
fi

echo "✅ Connected to Kubernetes cluster"

# Apply all manifests
echo "📦 Applying ConfigMap..."
kubectl apply -f k8s/configmap.yaml -n mcp-servers

echo "🔐 Applying Secret..."
kubectl apply -f k8s/secret.yaml -n mcp-servers

echo " Applying Deployment..."
kubectl apply -f k8s/deployment.yaml -n mcp-servers

echo "🌐 Applying Service..."
kubectl apply -f k8s/service.yaml -n mcp-servers

echo "🌍 Applying Ingress..."
kubectl apply -f k8s/ingress.yaml -n mcp-servers

echo "⏳ Waiting for deployment to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/serper-search -n mcp-servers

echo "✅ Deployment completed successfully!"

echo ""
echo "📋 Deployment Status:"
kubectl get pods -l app=serper-search -n mcp-servers
echo ""
kubectl get service serper-search-service -n mcp-servers
echo ""
kubectl get ingress serper-search-ingress -n mcp-servers

echo ""
echo "🔍 To test the service:"
echo "curl -X POST http://serper-search.homelab.local/search -H 'Content-Type: application/json' -d '{\"query\": \"test\", \"limit\": 2}'"
echo ""
echo "📊 To check logs:"
echo "kubectl logs -l app=serper-search -f -n mcp-servers"
echo ""
echo "🗑️ To remove the deployment:"
echo "kubectl delete -f k8s/ -n mcp-servers"
