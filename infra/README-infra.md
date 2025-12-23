# Notfall Demo – Infra Overview

This document explains how the demo stack is wired so it is easy to show to
partners (Google, grants, investors) and later grow into the production
architecture.

## 1. High-Level Layout

```text
notfall-demo/
├─ htdocs/                 # Static HTML demo (Fasthosts)
│   ├─ index.html          # Landing page (DAO waitlist)
│   └─ demo/               # Engineer dashboard demo
│
├─ api/                    # Node.js API (Express)
│   ├─ src/
│   │   ├─ index.js        # API entrypoint
│   │   ├─ controllers/
│   │   │   └─ waitlistController.js
│   │   ├─ routes/
│   │   │   └─ waitlistRoutes.js
│   │   ├─ services/
│   │   │   ├─ firestoreServices.js
│   │   │   └─ storageService.js
│   │   ├─ models/
│   │   │   └─ waitlistModel.js
│   │   ├─ config/
│   │   │   ├─ env.js
│   │   │   └─ mongo.js
│   │   └─ middleware/
│   │       └─ validateWaitlist.js
│   ├─ .env                # Local env vars (not committed)
│   └─ Dockerfile          # For Cloud Run deployment
│
└─ infra/
    ├─ gcp/
    │   ├─ service-account-README.md
    │   ├─ firestore.indexes.json    # Optional Firestore indexes
    │   └─ bigquery/
    │       └─ waitlist_schema.sql   # Optional analytics schema
    └─ cloudbuild/
        └─ cloudbuild-api.yaml       # CI/CD pipeline definition
