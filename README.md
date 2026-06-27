# Checkpoint Investment Management Platform

Checkpoint is a cloud-based platform designed to digitize, automate, and professionalize the financial management of VICOBA (Village Community Banks) and community investment clubs across East Africa.

**Deployment target:** Cloudflare frontend + Railway API + MongoDB Atlas

---

## 🚀 Local Development

This repository contains two main directories: `backend` (Node.js/Express API) and `frontend` (React + Vite).

### Prerequisites
- Node.js v18+
- npm

### 1. Backend

Create `backend/.env`:

```env
PORT=3001
MONGO_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/?appName=checkpoint
JWT_SECRET=your-long-random-secret
SMTP_USER=yourclub@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
```

> `SMTP_PASS` must be a **Gmail App Password** (16 chars), not your account password.
> Generate one at Google Account → Security → 2-Step Verification → App passwords.

```bash
cd backend
npm install
node server.js
```

API runs at `http://localhost:3001`. The frontend Vite dev server proxies all `/api` requests there automatically.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:5173`.

---

## ☁️ Production Deployment

### Cloudflare Pages Frontend + Railway API

The production frontend is deployed on **Cloudflare Pages** and points to the existing Express API hosted on **Railway**. MongoDB Atlas remains the database.

Cloudflare Pages settings:

```txt
Root directory: frontend
Build command: npm run build
Build output directory: dist
```

Set this Cloudflare Pages environment variable when the backend is hosted elsewhere:

```env
VITE_API_BASE_URL=https://your-backend-domain.com/api
```

The backend must also allow the Cloudflare Pages URL in CORS. For the initial deployment, set `CORS_ORIGIN=https://checkpoint-investmentclub.pages.dev` in Railway.

### Production Architecture

| Layer | Service |
|---|---|
| Frontend | **Cloudflare Pages** (`checkpoint-investmentclub`) |
| API | **Railway** (existing Node.js/Express backend) |
| Database | **MongoDB Atlas** |
| Email | **Gmail SMTP** via nodemailer |

The legacy Vercel serverless entry point remains available in `api/index.js`, but it is not part of the current deployment path.

### Railway Environment Variables

Set these in the Railway backend service:

| Key | Value |
|---|---|
| `MONGO_URI` | Your MongoDB Atlas connection string |
| `JWT_SECRET` | A long random string (generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `SMTP_USER` | `yourclub@gmail.com` |
| `SMTP_PASS` | Gmail App Password |
| `FORM_SECRET` | Shared secret used by Google Apps Script |
| `CORS_ORIGIN` | `https://checkpoint-investmentclub.pages.dev` |

### MongoDB Atlas — Important

Allow the Railway deployment to reach Atlas. If a stable egress IP is not configured, Atlas may need `0.0.0.0/0` with strong database credentials and least-privilege database users.

### Deploy

```bash
git push origin main   # Railway and Cloudflare auto-deploy from GitHub
```

---

## 🔐 Authentication

Members log in with their **email address** + password. The admin account uses username `admin` as a fallback.

Default member password: `checkpoint2025` (sent via welcome email on account creation).

---

## 📖 Documentation

- **[PRD.md](./PRD.md)** — Product Requirements Document: vision, constitution rules, feature specs.
- **[AGENT.md](./AGENT.md)** — AI pair programming changelog and architecture decisions.

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, CSS Variables |
| Backend | Node.js, Express 4 |
| Database | MongoDB Atlas (Mongoose 9) |
| Auth | JWT (7-day expiry, bcryptjs) |
| Email | Nodemailer + Gmail SMTP |
| PDF Export | jsPDF + jspdf-autotable |
| CSV Export | RFC 4180 compliant (vanilla JS) |
| Frontend Hosting | Cloudflare Pages |
| API Hosting | Railway |
| DB Hosting | MongoDB Atlas |
