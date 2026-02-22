# Checkpoint Investment Club Dashboard

Full-stack financial management web application for the Checkpoint Investment Club.

## Stack
- **Frontend**: React 18 + Vite + Recharts
- **Backend**: Node.js + Express
- **Database**: SQLite (file-based, no setup needed)
- **Auth**: JWT tokens

## Quick Start

### 1. Prerequisites
- Node.js 18+ installed ([nodejs.org](https://nodejs.org))

### 2. Install dependencies

```bash
# From the root directory:
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..
```

Or shortcut:
```bash
npm run install:all
```

### 3. Seed the database with real data

```bash
cd backend
npm run seed
```

This will populate the database with all historical data from the spreadsheet:
- All 10 members
- FY2024 & FY2025 contributions
- All 2025 loans and repayments
- Transaction history

### 4. Start the app

```bash
# From root directory:
npm run dev
```

This starts both servers:
- **Backend API**: http://localhost:3001
- **Frontend**: http://localhost:5173

Open http://localhost:5173 in your browser.

## Login Credentials

| Role   | Username   | Password        |
|--------|------------|-----------------|
| Admin  | admin      | admin123        |
| Member | ansgar     | checkpoint2025  |
| Member | elias      | checkpoint2025  |
| Member | emmanuel   | checkpoint2025  |
| Member | gibson     | checkpoint2025  |
| Member | ignas      | checkpoint2025  |
| Member | jakob      | checkpoint2025  |
| Member | joseph     | checkpoint2025  |
| Member | peter      | checkpoint2025  |
| Member | samwel     | checkpoint2025  |
| Member | william    | checkpoint2025  |

> **Admin** can add/edit contributions, issue loans, record repayments, manage members.
> **Members** can view all data (read-only).

## Features

### Overview
- Total equity, contributions, interest earned
- Monthly contribution trend (2024 vs 2025)
- Capital structure pie chart
- Active loans summary

### Contributions
- Monthly grid view per year (2024/2025)
- Color-coded compliance tracking
- Add new contribution with MPesa reference
- Target vs actual compliance rate

### Loans
- Full loan register with repayment tracking
- Issue new loans (auto-calculates 5% interest)
- Record repayments, mark loans as paid
- Loan detail modal with repayment history

### Members
- Member profile cards with compliance bars
- Individual contribution and loan history
- Add new members
- Unpaid fines tracking

### Transactions
- Complete transaction ledger (MPesa history)
- Filter by type (contribution/loan/transfer)
- Paginated with 30 records per page

### Investments
- Capital growth projections to 2030
- Phased roadmap (Foundation → Growth → Legacy)
- SWOT analysis
- Risk register

## Database Location
`backend/db/checkpoint.db`

To reset: delete `checkpoint.db` and run `npm run seed` again.

## Project Structure

```
checkpoint-dashboard/
├── backend/
│   ├── db/
│   │   ├── database.js    # Schema & DB connection
│   │   └── seed.js        # Real data seeder
│   ├── middleware/
│   │   └── auth.js        # JWT middleware
│   ├── routes/
│   │   ├── auth.js        # Login/logout
│   │   ├── members.js     # Member CRUD
│   │   ├── contributions.js
│   │   ├── loans.js       # Loans + repayments
│   │   ├── transactions.js
│   │   └── summary.js     # Dashboard analytics
│   └── server.js
├── frontend/
│   └── src/
│       ├── api/           # Axios API client
│       ├── components/    # UI components
│       └── views/         # Pages
└── README.md
```
