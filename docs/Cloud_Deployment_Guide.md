# Cloud Hosting & Deployment Guide

This guide covers how to deploy the **PostgreSQL-Based Fraud Detection and Temporal Money Tracing System** to the cloud.

---

## ⚠️ Key Architectural Requirements for Cloud Hosting

Before deploying, note these specific characteristics of our architecture:
1. **PostgreSQL Persistent Connections for `LISTEN/NOTIFY`:**
   The backend worker (`main.py`) keeps a persistent connection to receive real-time PostgreSQL notifications on `fraud_alerts_channel`. If using connection poolers like PgBouncer in *transaction pooling* mode, `LISTEN/NOTIFY` is disabled. Always connect the notification listener to direct port **5432** or a dedicated session-mode connection.
2. **WebSockets Support:**
   The API provides `/ws/alerts` for streaming alerts to the React Cytoscape graph. Your reverse proxy or hosting provider must support HTTP/1.1 Upgrade headers (`Connection: upgrade`).
3. **Database Tuning for 1M+ Transactions:**
   For the 1M transaction benchmark, allocate at least **2GB RAM** (recommended: 4GB) with `shared_buffers = 512MB` and `work_mem = 64MB`.

---

## Option 1: 1-Click Cloud VM / VPS (DigitalOcean / AWS EC2 / Hetzner) [Recommended]

This is the most cost-effective and reliable method because it runs the exact tuned PostgreSQL 16 container, FastAPI backend, and Nginx reverse proxy with one command.

### 1. Provision a Cloud Server
* OS: **Ubuntu 22.04 LTS** or **24.04 LTS**
* Specs: 2 vCPU, 4GB RAM (e.g., $12–$24/mo droplet or EC2 `t3.medium`)

### 2. Install Docker & Git
```bash
sudo apt update && sudo apt install -y git curl docker.io docker-compose-v2
sudo systemctl enable --now docker
```

### 3. Clone Repository & Deploy
```bash
git clone <your-repo-url> fraud-tracing-dbms
cd fraud-tracing-dbms

# Launch all 3 containers (Database + Backend + Frontend/Nginx)
sudo docker compose -f docker-compose.prod.yml up -d --build
```

### 4. Populate Benchmark Data Inside the Container
```bash
# Ingest 100,000 transactions (smoke test) or 1,000,000 (full benchmark):
sudo docker exec -it fraud_tracing_backend python scripts/generate_synthetic_data.py --rows 100000

# Run concurrency and verification harnesses:
sudo docker exec -it fraud_tracing_backend python scripts/exp_concurrency_double_spend.py
sudo docker exec -it fraud_tracing_backend python scripts/exp_idempotency_and_tamper.py
sudo docker exec -it fraud_tracing_backend python scripts/exp_evaluate_and_explain.py
```

### 5. Access the Dashboard
Navigate to `http://<YOUR_SERVER_PUBLIC_IP>` in your browser. Nginx serves the React dashboard and automatically routes `/api/` and `/ws/` to FastAPI.

---

## Option 2: Managed Cloud PaaS (Render / Railway)

If you don't want to manage a Linux server, you can host on managed PaaS platforms:

### A. Railway.app
1. Click **New Project > Provision PostgreSQL 16**.
2. Open Database Settings > Connect with `psql` or use Railway CLI to apply the SQL files in order (`sql/01` to `sql/09`).
3. Click **New > GitHub Repo > select `/backend` folder**:
   * Add Environment Variables:
     * `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (automatically linked from Railway PostgreSQL).
   * Railway automatically recognizes [`backend/Dockerfile`](file:///C:/Users/hp/.gemini/antigravity/scratch/fraud-tracing-dbms/backend/Dockerfile).
4. Click **New > GitHub Repo > select `/frontend` folder**:
   * Add Environment Variable:
     * `VITE_API_URL`: Point to Railway backend URL.

### B. Render.com
1. **PostgreSQL Database:** Create a Managed PostgreSQL 16 instance.
2. **Backend Web Service:**
   * Build: Docker (`backend/Dockerfile`)
   * Start command: `uvicorn main:app --host 0.0.0.0 --port 10000`
   * Set DB environment variables.
3. **Frontend Static Site:**
   * Build command: `npm install && npm run build`
   * Publish directory: `dist`
   * Add rewrite rules for SPA: `/* -> /index.html`.

---

## Option 3: Enterprise AWS Architecture (RDS + ECS + CloudFront)

For an enterprise-grade cloud deployment:
1. **Amazon RDS for PostgreSQL 16:**
   * DB Instance: `db.t4g.medium` or `db.m6g.large`
   * Custom Parameter Group: `shared_buffers = 512MB`, `work_mem = 64MB`.
   * Enable `pgcrypto` extension.
2. **Backend on AWS ECS (Fargate):**
   * Push `backend/Dockerfile` to Amazon ECR.
   * Run as an ECS Fargate Service behind an Application Load Balancer (ALB).
   * Enable WebSocket support on the ALB listener (port 80/443).
3. **Frontend on Amazon S3 + CloudFront:**
   * Upload `frontend/dist/` to an S3 bucket configured for static web hosting.
   * Route traffic through CloudFront with path pattern `/api/*` routed to the ALB and `/*` routed to S3.
