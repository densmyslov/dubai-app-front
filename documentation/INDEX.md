# Documentation Index

This folder contains all detailed documentation for the Dubai Real Estate Dashboard project.

## Available Documentation

### System Design & Architecture

- **[MIGRATION_SUMMARY.md](MIGRATION_SUMMARY.md)** - Summary of recent architectural changes
  - Session-based chart isolation
  - Auto-refresh manifest system
  - SessionContext implementation

### Feature Documentation

- **[MANIFEST.md](MANIFEST.md)** - Dynamic manifest system
  - Manifest schema and widget types
  - How to update dashboard content dynamically
  - LLM integration guide

- **[CHART_WEBHOOK.md](CHART_WEBHOOK.md)** - Chart webhook API
  - How to send charts from backend to frontend
  - API reference and examples
  - Session-based chart delivery

- **[CSV_DATA_SOURCE.md](CSV_DATA_SOURCE.md)** - CSV data source for charts
  - Load chart data from R2/external CSV files
  - Reduce LLM token costs by separating data from config
  - R2 storage structure and Lambda implementation
  - Security and lifecycle management

### Troubleshooting

- **[TROUBLESHOOTING_CSV_CHARTS.md](TROUBLESHOOTING_CSV_CHARTS.md)** - CSV chart issues
  - Fix "Failed to load CSV" errors
  - Resolve placeholder URL problems
  - Clear broken charts from KV storage
  - Backend validation examples

### Setup Guides

- **[CHART_KV_SETUP.md](CHART_KV_SETUP.md)** - Cloudflare KV setup
  - How to create and bind KV namespaces
  - Chart storage configuration
  - Session-based storage keys

- **[README.md](README.md)** - Deployment and quick start guide
  - How to deploy to Cloudflare Pages
  - Worker deployment
  - Environment variables

## Quick Links

- **Main Instructions:** [../CLAUDE.md](../CLAUDE.md) - Start here for development instructions
- **API Routes:** See `/app/api` folder for route implementations
- **Components:** See `/app/components` folder for React components

## Document Organization

All documentation follows these conventions:
- **Feature docs** describe how to use a specific feature
- **Setup guides** provide step-by-step configuration instructions
- **Architecture docs** explain system design and recent changes
- **API references** document endpoints, parameters, and examples

## Need Help?

1. Check [CLAUDE.md](../CLAUDE.md) first for general development instructions
2. Look for the relevant doc in this folder
3. Check inline code comments in `/app` for implementation details
4. See the Troubleshooting section in [CLAUDE.md](../CLAUDE.md)
