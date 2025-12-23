
---

### 4.2 `infra/gcp/service-account-README.md`

Create **`C:\Users\Student\Desktop\notfall-demo\infra\gcp\service-account-README.md`**:

```md
# GCP Service Account – Setup Guide

The Notfall demo API talks to **Firestore** and **Cloud Storage** using a
service account. This file explains how to create it and hook it into the
project.

## 1. Create the Service Account

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select the desired project (this must match `FIRESTORE_PROJECT_ID`).
3. Go to **IAM & Admin → Service Accounts**.
4. Click **Create service account**:
   - Name: `notfall-demo-api`
   - ID: `notfall-demo-api` (or similar)
   - Description: `Service account for Notfall demo waitlist API`.
5. After creation, click **Done** (or continue to granting roles in the next step).

## 2. Grant Roles

For the demo, the minimum recommended roles are:

- **Cloud Datastore User** (or **Firestore User**) – access to Firestore.
- **Storage Object Admin** (or more limited `Storage Object Creator` +
  `Storage Object Viewer`) – access to GCS bucket used for exports.

In a very early internal demo we can temporarily use **Editor** to avoid
permission issues, but this should be tightened before any external pilot.

You can add these roles in the **Permissions** tab of the service account.

## 3. Create the JSON Key

1. On the `notfall-demo-api` service account page, open the **Keys** tab.
2. Click **Add key → Create new key**.
3. Choose **JSON** and click **Create**.
4. A JSON file will be downloaded (e.g.
   `notfall-demo-api-1234567890abcdef.json`).

## 4. Place the Key in the Project

Move the JSON file into the `api` folder of the Notfall demo project:

```text
C:\Users\Student\Desktop\notfall-demo\api\service-account.json
