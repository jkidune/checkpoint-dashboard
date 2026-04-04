# Checkpoint Investment Management Platform

Checkpoint is a cloud-based SaaS platform designed to digitize, automate, and professionalize the financial management of VICOBA (Village Community Banks) and community investment clubs across East Africa.

## 🚀 Getting Started

This repository contains two main directories: `backend` (Node.js API) and `frontend` (React + Vite Web App).

### Prerequisites
- Node.js (v16+)
- npm or yarn

### 1. Starting the Backend
The backend runs on an Express server connected to MongoDB.

Ensure you have a `.env` file in the `backend/` directory with your MongoDB Atlas connection string:
```env
MONGO_URI=mongodb+srv://<user>:<password>@cluster0...
PORT=3001
```

```bash
cd backend
npm install
npm run dev
```
The API will run at `http://localhost:3001`.

### 2. Starting the Frontend
The frontend is a Vite + React application.

```bash
cd frontend
npm install
npm run dev
```
The application will be accessible at `http://localhost:5173`.

## 📖 Documentation
- **[PRD.md](./PRD.md)**: Product Requirements Document outlining vision, market, and feature specifications.
- **[AGENT.md](./AGENT.md)**: AI agent collaboration tracker and changelog.

## 🛠 Tech Stack
- **Frontend**: React, Vite, React Router, CSS Variables
- **Backend**: Node.js, Express, MongoDB (Mongoose)
