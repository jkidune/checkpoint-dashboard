# Checkpoint Investment Management Platform

Checkpoint is a cloud-based platform designed to digitize, automate, and professionalize the financial management of VICOBA (Village Community Banks) and community investment clubs across East Africa.

**Live:** [checkpoint-dashboard-roan.vercel.app](https://checkpoint-dashboard-roan.vercel.app)

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

### Architecture

| Layer | Service |
|---|---|
| Frontend + API | **Vercel** (single deployment — Express runs as a serverless function) |
| Database | **MongoDB Atlas** |
| Email | **Gmail SMTP** via nodemailer |

The Express backend is exported as a Vercel serverless function via `api/index.js`. All `/api/*` requests on the Vercel deployment are routed to that function. No separate backend host is needed.

### Vercel Environment Variables

Set these in **Vercel → Project → Settings → Environment Variables**:

| Key | Value |
|---|---|
| `MONGO_URI` | Your MongoDB Atlas connection string |
| `JWT_SECRET` | A long random string (generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `SMTP_USER` | `yourclub@gmail.com` |
| `SMTP_PASS` | Gmail App Password |

### MongoDB Atlas — Important

Allow all IPs in Atlas → Network Access → Add IP → **Allow Access from Anywhere** (`0.0.0.0/0`). Vercel serverless functions use dynamic IPs — a fixed whitelist will cause connection timeouts.

### Deploy

```bash
git push origin main   # Vercel auto-deploys on every push
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
| Hosting | Vercel (frontend + serverless API) |
| DB Hosting | MongoDB Atlas |
