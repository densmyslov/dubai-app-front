#!/bin/bash

# ============================================================================
# Chart Webhook Test Script
# ============================================================================
# This script tests the chart webhook endpoint by sending sample chart
# configurations. Use it to verify your chart webhook is working correctly.
#
# Usage:
#   chmod +x test-chart-webhook.sh
#   ./test-chart-webhook.sh [URL] [SECRET]
#
# Examples:
#   ./test-chart-webhook.sh http://localhost:3000 your-secret
#   ./test-chart-webhook.sh https://your-app.pages.dev your-secret
# ============================================================================

# Configuration
URL="${1:-http://localhost:3000}"
SECRET="${2:-proli-troli-hupla-boobs}"
ENDPOINT="$URL/api/charts"

echo "============================================"
echo "Chart Webhook Test Script"
echo "============================================"
echo "Endpoint: $ENDPOINT"
echo "Secret: ${SECRET:0:8}..."
echo ""

# Test 1: Add a line chart
echo "Test 1: Adding line chart..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{
    "action": "add",
    "chartId": "test-line-chart",
    "config": {
      "title": "Test Line Chart",
      "chartType": "line",
      "categories": ["Jan", "Feb", "Mar", "Apr", "May"],
      "series": [
        {
          "name": "Sales",
          "data": [120, 200, 150, 180, 220]
        },
        {
          "name": "Expenses",
          "data": [80, 90, 100, 95, 110]
        }
      ]
    }
  }'
echo -e "\n"

# Test 2: Add a bar chart
echo "Test 2: Adding bar chart..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{
    "action": "add",
    "chartId": "test-bar-chart",
    "config": {
      "title": "Test Bar Chart",
      "chartType": "bar",
      "categories": ["Product A", "Product B", "Product C"],
      "series": [
        {
          "name": "Q1",
          "data": [100, 150, 120]
        },
        {
          "name": "Q2",
          "data": [120, 180, 140]
        }
      ]
    }
  }'
echo -e "\n"

# Test 3: Add a pie chart
echo "Test 3: Adding pie chart..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{
    "action": "add",
    "chartId": "test-pie-chart",
    "config": {
      "title": "Test Pie Chart",
      "chartType": "pie",
      "series": [
        {
          "name": "Distribution",
          "data": [
            {"value": 335, "name": "Category A"},
            {"value": 234, "name": "Category B"},
            {"value": 154, "name": "Category C"},
            {"value": 121, "name": "Category D"}
          ]
        }
      ]
    }
  }'
echo -e "\n"

# Wait a bit
echo "Waiting 2 seconds..."
sleep 2

# Test 4: Update the line chart
echo "Test 4: Updating line chart..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{
    "action": "update",
    "chartId": "test-line-chart",
    "config": {
      "title": "Test Line Chart (Updated)",
      "chartType": "line",
      "categories": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      "series": [
        {
          "name": "Sales",
          "data": [120, 200, 150, 180, 220, 250]
        },
        {
          "name": "Expenses",
          "data": [80, 90, 100, 95, 110, 120]
        }
      ]
    }
  }'
echo -e "\n"

# Wait a bit
echo "Waiting 3 seconds before cleanup..."
sleep 3

# Test 5: Remove a chart
echo "Test 5: Removing pie chart..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{
    "action": "remove",
    "chartId": "test-pie-chart"
  }'
echo -e "\n"

# Health check
echo "Test 6: Health check..."
curl -X GET "$ENDPOINT"
echo -e "\n"

echo ""
echo "============================================"
echo "Tests complete!"
echo "Check your dashboard at: $URL"
echo "============================================"
