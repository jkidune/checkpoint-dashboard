import { useState } from 'react';
import {
  AlertTriangle, ArrowRight, Banknote, Bell, CircleDollarSign, Command,
  CreditCard, Download, FileArchive, FileCheck2, FileClock, HandCoins, HelpCircle,
  Home, Landmark, LineChart as LineChartIcon, Mail, MoreHorizontal, PiggyBank,
  Receipt, Search, Settings, ShieldCheck, FileText, UploadCloud,
  SlidersHorizontal, TrendingUp, UsersRound,
} from 'lucide-react';
import '../design-system.css';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  ActivityTimeline,
  ChartCard,
  DetailSheet,
  EmptyState,
  FinancialBarChart,
  FinancialDonutChart,
  FinancialStackedBarChart,
  FinancialTrendChart,
  MetricCard,
  MetricSparkline,
  MoneyStat,
  QuarterlyReportBanner,
  QuarterlyReportList,
  ReportDetailSheet,
  ReportStatusBadge,
  StatusBadge,
  formatCompactTZS,
} from '@/components/checkpoint';

const navItems = [
  ['Overview', Home],
  ['Contributions', HandCoins],
  ['Loans', Banknote],
  ['Members', UsersRound],
  ['Transactions', Receipt],
  ['Investments', LineChartIcon],
  ['Expenses', CreditCard],
  ['Reports', FileText],
];

const memberNavItems = [
  ['Overview', Home],
  ['Contributions', HandCoins],
  ['Loans', Banknote],
  ['Transactions', Receipt],
  ['Investments', LineChartIcon],
  ['Statements', FileText],
  ['Reports', FileArchive],
  ['Notifications', Bell],
];

const activity = [
  { title: 'Contribution corrected', meta: '22 Aug · Admin', description: 'Reference and amount reconciled before approval.' },
  { title: 'Contact information updated', meta: '18 Aug · Secretary' },
  { title: 'Loan repayment recorded', meta: '12 Aug · Treasurer' },
];

const loans = [
  { member: 'Amina Example', email: 'amina@checkpoint.tz', initials: 'AE', principal: 'TZS 1,200,000', outstanding: 'TZS 620,000', next: '05 Sep 2026', status: 'Active', avatar: 'teal' },
  { member: 'Daniel Example', email: 'daniel@checkpoint.tz', initials: 'DE', principal: 'TZS 900,000', outstanding: 'TZS 220,000', next: 'Overdue', status: 'Overdue', avatar: 'amber' },
  { member: 'Neema Example', email: 'neema@checkpoint.tz', initials: 'NE', principal: 'TZS 650,000', outstanding: 'TZS 140,000', next: '14 Sep 2026', status: 'Review', avatar: 'blue' },
  { member: 'Peter Example', email: 'peter@checkpoint.tz', initials: 'PE', principal: 'TZS 400,000', outstanding: 'TZS 0', next: 'Closed', status: 'Paid', avatar: 'slate' },
  { member: 'Sarah Example', email: 'sarah@checkpoint.tz', initials: 'SE', principal: 'TZS 750,000', outstanding: 'TZS 310,000', next: '20 Sep 2026', status: 'Active', avatar: 'rose' },
];

const equityTrendData = [
  { month: 'Jan', equity: 11800000 },
  { month: 'Feb', equity: 12350000 },
  { month: 'Mar', equity: 12800000 },
  { month: 'Apr', equity: 13500000 },
  { month: 'May', equity: 14150000 },
  { month: 'Jun', equity: 14700000 },
  { month: 'Jul', equity: 15050000 },
  { month: 'Aug', equity: 15540000 },
];

const contributionComparisonData = [
  { month: 'Jan', expected: 850000, received: 820000 },
  { month: 'Feb', expected: 850000, received: 850000 },
  { month: 'Mar', expected: 900000, received: 870000 },
  { month: 'Apr', expected: 900000, received: 930000 },
  { month: 'May', expected: 900000, received: 890000 },
  { month: 'Jun', expected: 950000, received: 910000 },
  { month: 'Jul', expected: 950000, received: 960000 },
  { month: 'Aug', expected: 950000, received: 940000 },
];

const contributionStatusData = [
  { month: 'Jan', paid: 760000, outstanding: 90000 },
  { month: 'Feb', paid: 810000, outstanding: 40000 },
  { month: 'Mar', paid: 780000, outstanding: 120000 },
  { month: 'Apr', paid: 860000, outstanding: 40000 },
  { month: 'May', paid: 825000, outstanding: 75000 },
  { month: 'Jun', paid: 875000, outstanding: 75000 },
  { month: 'Jul', paid: 910000, outstanding: 40000 },
  { month: 'Aug', paid: 895000, outstanding: 55000 },
];

const capitalCompositionData = [
  { name: 'Cash', value: 4972800, percent: 32, color: 'var(--chart-primary)' },
  { name: 'Loans', value: 4195800, percent: 27, color: 'var(--chart-secondary)' },
  { name: 'Investments', value: 4817400, percent: 31, color: 'var(--chart-success)' },
  { name: 'Other', value: 1554000, percent: 10, color: 'var(--chart-reference)' },
];

const memberContributionData = [
  { month: 'Jan', contributions: 100000 },
  { month: 'Feb', contributions: 100000 },
  { month: 'Mar', contributions: 125000 },
  { month: 'Apr', contributions: 100000 },
  { month: 'May', contributions: 125000 },
  { month: 'Jun', contributions: 110000 },
  { month: 'Jul', contributions: 115000 },
  { month: 'Aug', contributions: 125000 },
];

const sparklineData = [
  { month: 'Jan', value: 11800000 },
  { month: 'Feb', value: 12350000 },
  { month: 'Mar', value: 12800000 },
  { month: 'Apr', value: 13500000 },
  { month: 'May', value: 14150000 },
  { month: 'Jun', value: 14700000 },
  { month: 'Jul', value: 15050000 },
  { month: 'Aug', value: 15540000 },
];

const reports = [
  {
    id: 'q3-2026',
    title: 'Q3 2026 Quarterly Club Report',
    quarter: 'Q3',
    year: 2026,
    cutoffDate: '30 September 2026',
    publishedAt: null,
    uploadedAt: '14 October 2026',
    uploadedBy: { name: 'Joseph M.', role: 'Administrator', initials: 'JM', avatar: null },
    status: 'draft',
    version: 1,
    filename: 'checkpoint-q3-2026-report.pdf',
    fileSize: '2.8 MB',
    viewed: false,
    activity: [
      { title: 'Report uploaded', meta: '14 Oct 2026 · Joseph M.', description: 'Initial draft uploaded for Admin preview.' },
      { title: 'Reconciliation cutoff confirmed', meta: '30 Sep 2026 · Treasurer' },
    ],
  },
  {
    id: 'q2-2026',
    title: 'Q2 2026 Quarterly Club Report',
    quarter: 'Q2',
    year: 2026,
    cutoffDate: '30 June 2026',
    publishedAt: '18 July 2026',
    uploadedAt: '16 July 2026',
    uploadedBy: { name: 'Joseph M.', role: 'Administrator', initials: 'JM', avatar: null },
    status: 'published',
    version: 2,
    filename: 'checkpoint-q2-2026-report.pdf',
    fileSize: '2.4 MB',
    viewed: false,
    activity: [
      { title: 'Published report', meta: '18 Jul 2026 · Joseph M.', description: 'Members can view and download this report.' },
      { title: 'Report replaced', meta: '17 Jul 2026 · Version 2 uploaded' },
      { title: 'Initial report uploaded', meta: '16 Jul 2026 · Joseph M.' },
    ],
  },
  {
    id: 'q1-2026',
    title: 'Q1 2026 Quarterly Club Report',
    quarter: 'Q1',
    year: 2026,
    cutoffDate: '31 March 2026',
    publishedAt: '12 April 2026',
    uploadedAt: '10 April 2026',
    uploadedBy: { name: 'Joseph M.', role: 'Administrator', initials: 'JM', avatar: null },
    status: 'published',
    version: 1,
    filename: 'checkpoint-q1-2026-report.pdf',
    fileSize: '2.1 MB',
    viewed: true,
    activity: [
      { title: 'Published report', meta: '12 Apr 2026 · Joseph M.' },
      { title: 'Initial report uploaded', meta: '10 Apr 2026 · Joseph M.' },
    ],
  },
  {
    id: 'q4-2025',
    title: 'Q4 2025 Quarterly Club Report',
    quarter: 'Q4',
    year: 2025,
    cutoffDate: '31 December 2025',
    publishedAt: '15 January 2026',
    uploadedAt: '13 January 2026',
    uploadedBy: { name: 'Joseph M.', role: 'Administrator', initials: 'JM', avatar: null },
    status: 'archived',
    version: 1,
    filename: 'checkpoint-q4-2025-report.pdf',
    fileSize: '2.0 MB',
    viewed: true,
    activity: [
      { title: 'Archived report', meta: '02 Aug 2026 · Joseph M.', description: 'Publication record remains in Admin history.' },
      { title: 'Published report', meta: '15 Jan 2026 · Joseph M.' },
    ],
  },
  {
    id: 'q3-2025',
    title: 'Q3 2025 Quarterly Club Report',
    quarter: 'Q3',
    year: 2025,
    cutoffDate: '30 September 2025',
    publishedAt: '16 October 2025',
    uploadedAt: '14 October 2025',
    uploadedBy: { name: 'Joseph M.', role: 'Administrator', initials: 'JM', avatar: null },
    status: 'published',
    version: 1,
    filename: 'checkpoint-q3-2025-report.pdf',
    fileSize: '1.9 MB',
    viewed: true,
    activity: [
      { title: 'Published report', meta: '16 Oct 2025 · Joseph M.' },
      { title: 'Initial report uploaded', meta: '14 Oct 2025 · Joseph M.' },
    ],
  },
];

const memberVisibleReports = reports.filter((report) => report.status === 'published');

function ShowroomSwitcher() {
  return (
    <TabsList className="cp-showroom-switcher">
      <TabsTrigger value="admin">Admin</TabsTrigger>
      <TabsTrigger value="member">Member</TabsTrigger>
      <TabsTrigger value="auth">Auth</TabsTrigger>
      <TabsTrigger value="charts">Charts</TabsTrigger>
      <TabsTrigger value="reports">Reports</TabsTrigger>
      <TabsTrigger value="components">Components</TabsTrigger>
    </TabsList>
  );
}

function AdminSidebar() {
  return (
    <aside className="cp-admin-sidebar">
      <div className="cp-brand-lockup">
        <div className="cp-brand-mark">C</div>
        <div>
          <div className="cp-brand-name">Checkpoint</div>
          <div className="cp-brand-subtitle">Investment Club</div>
        </div>
      </div>
      <div className="cp-sidebar-context">
        <div className="cp-sidebar-context-icon"><Landmark size={15} /></div>
        <div>
          <strong>Checkpoint IC</strong>
          <span>FY2026 · 42 members</span>
        </div>
      </div>
      <nav className="cp-admin-nav" aria-label="Showroom navigation">
        {navItems.map(([label, Icon], index) => (
          <button key={label} className={`cp-admin-nav-item ${index === 0 ? 'is-active' : ''}`} type="button">
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="cp-admin-sidebar-secondary">
        <button className="cp-admin-nav-item" type="button"><HelpCircle size={15} />Help & Support</button>
        <button className="cp-admin-nav-item" type="button"><Settings size={15} />Settings</button>
      </div>
      <div className="cp-sidebar-account">
        <Avatar className="cp-user-avatar is-blue"><AvatarFallback>AE</AvatarFallback></Avatar>
        <div>
          <strong>Admin Example</strong>
          <span>Administrator</span>
        </div>
      </div>
    </aside>
  );
}

function MemberSidebar() {
  return (
    <aside className="cp-admin-sidebar cp-member-sidebar">
      <div className="cp-brand-lockup">
        <div className="cp-brand-mark">C</div>
        <div>
          <div className="cp-brand-name">Checkpoint</div>
          <div className="cp-brand-subtitle">Member Portal</div>
        </div>
      </div>
      <nav className="cp-admin-nav" aria-label="Member showroom navigation">
        {memberNavItems.map(([label, Icon], index) => (
          <button key={label} className={`cp-admin-nav-item ${index === 0 ? 'is-active' : ''}`} type="button">
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="cp-admin-sidebar-secondary">
        <button className="cp-admin-nav-item" type="button"><HelpCircle size={15} />Help</button>
        <button className="cp-admin-nav-item" type="button"><Settings size={15} />Settings</button>
      </div>
      <div className="cp-sidebar-account">
        <Avatar className="cp-user-avatar is-teal"><AvatarFallback>AM</AvatarFallback></Avatar>
        <div>
          <strong>Amina M.</strong>
          <span>Member</span>
        </div>
      </div>
    </aside>
  );
}

function AdminHeader() {
  return (
    <header className="cp-admin-header">
      <div>
        <div className="cp-label text-primary">Admin workspace</div>
        <h1 className="cp-page-title">Investment overview</h1>
      </div>
      <div className="cp-admin-header-actions">
        <Select defaultValue="fy2026">
          <SelectTrigger className="cp-compact-control"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fy2026">FY2026</SelectItem>
            <SelectItem value="fy2025">FY2025</SelectItem>
          </SelectContent>
        </Select>
        <button className="cp-command" type="button">
          <Search size={14} />
          <span>Search records...</span>
          <kbd><Command size={11} />K</kbd>
        </button>
        <Button variant="ghost" size="icon-sm" aria-label="Notifications"><Bell size={15} /></Button>
        <div className="cp-admin-user">
          <Avatar className="size-8"><AvatarFallback>JM</AvatarFallback></Avatar>
          <div><strong>Joseph M.</strong><span>Super admin</span></div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Overview actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Export snapshot</DropdownMenuItem>
            <DropdownMenuItem>Open audit trail</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function FinancialSummary() {
  return (
    <section className="cp-financial-summary">
      <Card className="cp-primary-finance-card">
        <CardContent>
          <div className="cp-finance-card-topline"><span>Total club asset value</span><Landmark size={17} /></div>
          <div className="cp-hero-money">TZS 15.54M</div>
          <div className="cp-finance-meta"><TrendingUp size={13} /> +4.2% last 30 days · reconciled 22 Aug</div>
        </CardContent>
      </Card>
      <div className="cp-supporting-metrics">
        <MoneyStat title="Cash at Bank" value="TZS 8.20M" supportingText="M-Koba confirmed" icon={PiggyBank} />
        <MoneyStat title="Loans Outstanding" value="TZS 4.15M" supportingText="Principal balance" icon={Banknote} />
        <MoneyStat title="Members in good standing" value="32" supportingText="6 need review" icon={UsersRound} />
      </div>
    </section>
  );
}

function FinancialPosition() {
  return (
    <ChartCard
      title="Financial position"
      description="Monthly closing club equity using dummy showroom data."
      metric="TZS 15.54M"
      trend="+4.2% vs previous period"
    >
      <FinancialTrendChart
        data={equityTrendData}
        xKey="month"
        series={[{ key: 'equity', label: 'Club equity', color: 'primary' }]}
        height={250}
      />
    </ChartCard>
  );
}

function RequiresAttention() {
  return (
    <Card className="cp-panel">
      <CardHeader>
        <div>
          <CardTitle>Requires attention</CardTitle>
          <CardDescription>Compact operational exceptions for review.</CardDescription>
        </div>
        <AlertTriangle size={16} className="text-warning" />
      </CardHeader>
      <CardContent className="cp-attention-list">
        {[
          ['Amina Example', '1 missed contribution · 2 overdue fines', 'TZS 85,000'],
          ['Daniel Example', 'Loan payment overdue', 'TZS 220,000'],
        ].map(([name, issue, amount]) => (
          <div className="cp-attention-row" key={name}>
            <div>
              <div className="cp-row-title">{name}</div>
              <div className="cp-row-muted">{issue}</div>
            </div>
            <div className="cp-attention-amount">{amount} outstanding</div>
            <Button variant="ghost" size="sm">Review <ArrowRight size={13} /></Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AdminFilterBar() {
  return (
    <div className="cp-filter-toolbar">
      <div className="cp-filter-search"><Search size={14} /><input placeholder="Search members..." /></div>
      <Select defaultValue="fy2026">
        <SelectTrigger className="cp-filter-select"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="fy2026">FY2026</SelectItem><SelectItem value="fy2025">FY2025</SelectItem></SelectContent>
      </Select>
      <Select defaultValue="active">
        <SelectTrigger className="cp-filter-select"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="active">Status: Active</SelectItem><SelectItem value="review">Status: Review</SelectItem><SelectItem value="overdue">Status: Overdue</SelectItem></SelectContent>
      </Select>
      <Button variant="ghost" size="sm"><SlidersHorizontal size={14} /> More filters</Button>
      <div className="cp-filter-spacer" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Download size={14} /> Export</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem>Export CSV</DropdownMenuItem><DropdownMenuItem>Export PDF snapshot</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MemberDetailSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild><Button variant="outline" size="sm">Open member detail</Button></SheetTrigger>
      <SheetContent className="cp-detail-sheet">
        <SheetHeader>
          <div className="cp-sheet-person">
            <Avatar className="size-10"><AvatarFallback>AE</AvatarFallback></Avatar>
            <div><SheetTitle>Amina Example</SheetTitle><SheetDescription>Active Member</SheetDescription></div>
          </div>
        </SheetHeader>
        <div className="cp-sheet-section">
          <div className="cp-sheet-section-title">Contact</div>
          <div className="cp-definition-list">
            <span>Email</span><strong>amina@example.com</strong>
            <span>Phone</span><strong>+255 700 000 000</strong>
            <span>Account status</span><StatusBadge status="Active" />
          </div>
        </div>
        <div className="cp-sheet-section">
          <div className="cp-sheet-section-title">Financial position</div>
          <div className="cp-sheet-metrics">
            <div><span>Contributions</span><strong>TZS 900,000</strong></div>
            <div><span>Loan balance</span><strong>TZS 250,000</strong></div>
            <div><span>Fines</span><strong>TZS 85,000</strong></div>
          </div>
        </div>
        <div className="cp-sheet-section">
          <div className="cp-sheet-section-title">Activity</div>
          <ActivityTimeline items={activity} />
        </div>
        <SheetFooter><Button variant="outline">Close</Button><Button>Edit member</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ActiveLoansTable() {
  return (
    <Card className="cp-panel cp-table-panel">
      <CardHeader>
        <div><CardTitle>Member loan register</CardTitle><CardDescription>Table-first workflow with member identity, balances and contextual actions.</CardDescription></div>
        <MemberDetailSheet />
      </CardHeader>
      <CardContent>
        <AdminFilterBar />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="text-right">Principal</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Next payment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loans.map(({ member, email, initials, principal, outstanding, next, status, avatar }) => (
              <TableRow key={member}>
                <TableCell>
                  <div className="cp-member-cell">
                    <Avatar className={`cp-user-avatar is-${avatar}`}><AvatarFallback>{initials}</AvatarFallback></Avatar>
                    <span><strong>{member}</strong><small>{email}</small></span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{principal}</TableCell>
                <TableCell className="text-right tabular-nums">{outstanding}</TableCell>
                <TableCell>{next}</TableCell>
                <TableCell><StatusBadge status={status} /></TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><MoreHorizontal size={15} /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end"><DropdownMenuItem>Open detail</DropdownMenuItem><DropdownMenuItem>Review schedule</DropdownMenuItem></DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AdminSample() {
  return (
    <section className="cp-admin-app-shell">
      <AdminSidebar />
      <main className="cp-admin-main">
        <AdminHeader />
        <FinancialSummary />
        <div className="cp-stock-strip">
          <div><strong>42</strong><span>members</span></div>
          <div className="cp-stock-meter"><i /><i /><i /></div>
          <span><b /> In good standing: 32</span>
          <span><b className="is-warning" /> Review: 6</span>
          <span><b className="is-danger" /> Overdue: 4</span>
        </div>
        <div className="cp-admin-grid"><FinancialPosition /><RequiresAttention /></div>
        <div className="cp-admin-grid cp-admin-grid-bottom"><ActiveLoansTable /><Card className="cp-panel"><CardHeader><div><CardTitle>Recent activity</CardTitle><CardDescription>Compact audit feed sample.</CardDescription></div></CardHeader><CardContent><ActivityTimeline items={activity} /></CardContent></Card></div>
      </main>
    </section>
  );
}

function MemberSample() {
  return (
    <section className="cp-design-system cp-theme-member cp-member-app-shell">
      <MemberSidebar />
      <main className="cp-member-main">
        <div className="cp-member-hero">
          <div><div className="cp-label text-primary">Member experience</div><h2 className="cp-page-title">Good evening, Amina</h2><p>Your contributions, obligations and recent activity in one calm workspace.</p></div>
          <Button variant="outline">View statement</Button>
        </div>
        <div className="cp-member-cards">
          <MoneyStat title="My Contributions" value="TZS 900,000" supportingText="FY2026 paid" icon={CircleDollarSign} tone="primary" />
          <MoneyStat title="Loan Balance" value="TZS 250,000" supportingText="Due in 42 days" icon={Banknote} />
          <MetricCard label="Standing" value="Good" description="No overdue fines or missed periods." icon={ShieldCheck} />
        </div>
        <div className="cp-member-grid">
          <ChartCard
            title="My contributions"
            description="Month-by-month contribution history."
            metric="TZS 900K"
            trend="On track for FY2026"
            action={<Badge variant="neutral">FY2026</Badge>}
          >
            <FinancialTrendChart
              data={memberContributionData}
              xKey="month"
              series={[{ key: 'contributions', label: 'Contributions', color: 'secondary' }]}
              height={225}
            />
          </ChartCard>
          <Card className="cp-member-panel"><CardHeader><CardTitle>Upcoming obligation</CardTitle><CardDescription>Next payment due.</CardDescription></CardHeader><CardContent><div className="cp-member-obligation"><strong>TZS 250,000</strong><span>Loan payment · due 05 Sep 2026</span><Button size="sm">Review payment</Button></div></CardContent></Card>
        </div>
        <Card className="cp-table-panel"><CardHeader><CardTitle>Recent transactions</CardTitle><CardDescription>Member-facing transaction list sample.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{[['22 Aug', 'Contribution', 'TZS 150,000', 'Paid'], ['15 Aug', 'Loan repayment', 'TZS 75,000', 'Paid'], ['01 Aug', 'Fine', 'TZS 10,000', 'Review']].map(([date, type, amount, status]) => <TableRow key={`${date}-${type}`}><TableCell>{date}</TableCell><TableCell>{type}</TableCell><TableCell className="text-right tabular-nums">{amount}</TableCell><TableCell><StatusBadge status={status} /></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      </main>
    </section>
  );
}

function ChartsShowcase() {
  return (
    <section className="cp-charts-showcase">
      <div className="cp-showcase-section-heading">
        <div>
          <div className="cp-label text-primary">Financial chart system</div>
          <h2 className="cp-section-title">Reusable patterns for Checkpoint reporting</h2>
          <p>Dummy investment-club data only. Components receive prepared values and perform presentation formatting only.</p>
        </div>
        <Badge variant="neutral">Recharts 2.12 compatible</Badge>
      </div>

      <div className="cp-chart-showcase-grid">
        <ChartCard
          title="Club equity trend"
          description="Monthly closing asset value."
          metric={formatCompactTZS(15540000)}
          trend="+4.2% vs previous period"
        >
          <FinancialTrendChart
            data={equityTrendData}
            xKey="month"
            series={[{ key: 'equity', label: 'Club equity', color: 'primary' }]}
          />
        </ChartCard>

        <ChartCard
          title="Contributions — expected vs received"
          description="Monthly contribution target compared with actual receipts."
          metric={formatCompactTZS(940000)}
          trend="August received"
        >
          <FinancialBarChart
            data={contributionComparisonData}
            xKey="month"
            series={[
              { key: 'expected', label: 'Expected', color: 'reference' },
              { key: 'received', label: 'Received', color: 'primary' },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Contribution payment status"
          description="Paid and outstanding values stacked only where they form a monthly total."
          metric={formatCompactTZS(950000)}
          trend="August target"
        >
          <FinancialStackedBarChart
            data={contributionStatusData}
            xKey="month"
            series={[
              { key: 'paid', label: 'Paid', color: 'success' },
              { key: 'outstanding', label: 'Outstanding', color: 'warning' },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Club capital composition"
          description="A restrained donut for low-cardinality composition only."
          metric={formatCompactTZS(15540000)}
          trend="Total capital"
          action={<Badge variant="neutral">Snapshot</Badge>}
        >
          <FinancialDonutChart data={capitalCompositionData} total={15540000} />
        </ChartCard>
      </div>

      <div className="cp-sparkline-grid">
        <MetricSparkline label="Club Equity" value="TZS 15.54M" trend="+4.2%" data={sparklineData} />
        <MetricSparkline label="Cash at Bank" value="TZS 8.20M" trend="+1.8%" data={sparklineData.map((item, index) => ({ ...item, value: 7200000 + index * 140000 }))} color="secondary" />
        <MetricSparkline label="Loans Outstanding" value="TZS 4.15M" trend="-2.1%" data={sparklineData.map((item, index) => ({ ...item, value: 4700000 - index * 78500 }))} color="warning" />
      </div>
    </section>
  );
}

function AuthSample() {
  return (
    <section className="cp-design-system cp-theme-auth cp-auth-showroom">
      <div className="cp-auth-art">
        <div className="cp-brand-lockup"><div className="cp-brand-mark">C</div><div><div className="cp-brand-name">Checkpoint</div><div className="cp-brand-subtitle">Member capital, organized.</div></div></div>
        <div className="cp-auth-message"><div className="cp-label text-primary">Investment club operations</div><h2>Confidence before every decision.</h2><p>Reconcile contributions, loans, fines and member records inside a calm financial workspace.</p></div>
        <div className="cp-auth-proof"><span>TZS 15.54M</span><small>Club equity snapshot</small></div>
      </div>
      <Card className="cp-auth-card">
        <CardHeader><CardTitle>Welcome back to Checkpoint</CardTitle><CardDescription>Sign in to review your club dashboard.</CardDescription></CardHeader>
        <CardContent className="cp-auth-form">
          <div><Label htmlFor="auth-email">Email</Label><Input id="auth-email" placeholder="amina@example.com" /></div>
          <div><Label htmlFor="auth-password">Password</Label><Input id="auth-password" type="password" placeholder="••••••••" /></div>
          <Button className="w-full">Sign in</Button>
          <div className="cp-auth-links"><a href="/">Forgot password?</a><a href="/">Activate member account</a></div>
        </CardContent>
      </Card>
    </section>
  );
}

function ReportConfirmation({ type, report, trigger }) {
  const copy = {
    publish: {
      icon: FileCheck2,
      title: `Publish ${report.quarter} ${report.year} Quarterly Report?`,
      description: 'Members will be able to view and download this report immediately. Confirm that reconciliation and follow-up for this quarter are complete before publishing.',
      action: 'Publish report',
    },
    replace: {
      icon: UploadCloud,
      title: 'Replace published report?',
      description: 'The current report will remain part of the activity history. A new version will become the active member-facing report after confirmation.',
      action: 'Continue',
    },
    archive: {
      icon: FileArchive,
      title: `Archive ${report.quarter} ${report.year} report?`,
      description: 'Members will no longer see this report in their normal report list. The publication record will remain in Admin history.',
      action: 'Archive report',
    },
  }[type];
  const Icon = copy.icon;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="cp-report-confirmation">
        <AlertDialogHeader>
          <AlertDialogMedia><Icon size={20} /></AlertDialogMedia>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>{copy.action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MemberReportsExperience() {
  const newReport = reports.find((report) => report.id === 'q2-2026');
  const viewedReport = reports.find((report) => report.id === 'q1-2026');

  return (
    <section className="cp-report-experience">
      <div className="cp-showcase-section-heading">
        <div>
          <div className="cp-label text-primary">Member experience</div>
          <h2 className="cp-section-title">Quarterly Reports</h2>
          <p>Financial reports published by your club administrator. Members see published reports only.</p>
        </div>
        <ReportStatusBadge status="published">Member-visible</ReportStatusBadge>
      </div>

      <div className="cp-report-banner-grid">
        <div>
          <div className="cp-report-specimen-label">Variant A — Document Notice</div>
          <QuarterlyReportBanner report={newReport} variant="notice" />
        </div>
        <div>
          <div className="cp-report-specimen-label">Variant B — Soft Accent Banner</div>
          <QuarterlyReportBanner report={newReport} variant="accent" />
        </div>
      </div>

      <QuarterlyReportBanner report={viewedReport} viewed />

      <div className="cp-report-member-layout">
        <QuarterlyReportList
          title="Quarterly Reports"
          description="Financial reports published by your club administrator."
          reports={memberVisibleReports}
          audience="member"
          groupByYear
        />
        <div className="cp-report-side-stack">
          <ReportDetailSheet
            report={newReport}
            trigger={<Button variant="outline"><FileText size={14} /> Open report detail Sheet</Button>}
          />
          <EmptyState
            icon={FileArchive}
            title="No reports published yet"
            description="Quarterly financial reports will appear here after they are reviewed and published by your club administrator."
          />
          <Card className="cp-report-error-card">
            <CardContent>
              <AlertTriangle size={18} />
              <div><strong>Report unavailable</strong><span>We could not load this report right now.</span></div>
              <Button variant="outline" size="sm">Try again</Button>
            </CardContent>
          </Card>
          <Card className="cp-report-notification">
            <CardContent>
              <Bell size={16} />
              <div><strong>Quarterly report published</strong><span>Q2 2026 club report is now available.</span></div>
              <time>18 Jul</time>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function AdminReportStateCard({ report, state }) {
  const isNoReport = state === 'empty';
  const isDraft = report?.status === 'draft';
  const isPublished = report?.status === 'published';

  return (
    <Card className="cp-admin-report-state">
      <CardHeader>
        <div>
          <CardTitle>{isNoReport ? 'Q3 2026' : report.title}</CardTitle>
          <CardDescription>
            {isNoReport ? 'No quarterly report has been uploaded.' : `Reconciliation cutoff: ${report.cutoffDate}`}
          </CardDescription>
        </div>
        {!isNoReport && <ReportStatusBadge status={report.status}>{report.status}</ReportStatusBadge>}
      </CardHeader>
      <CardContent>
        {isNoReport ? (
          <div className="cp-report-no-upload">
            <span>Reconciliation cutoff</span>
            <strong>30 September 2026</strong>
            <Button size="sm"><UploadCloud size={14} /> Upload report</Button>
          </div>
        ) : (
          <>
            <div className="cp-report-file-card">
              <FileText size={18} />
              <div><strong>{report.filename}</strong><span>{report.fileSize}</span></div>
            </div>
            <div className="cp-report-definition-grid is-compact">
              <span>Uploaded</span><strong>{report.uploadedAt}</strong>
              <span>Uploaded by</span><strong>{report.uploadedBy.name}</strong>
              <span>Version</span><strong>v{report.version}</strong>
              {isPublished && <><span>Published</span><strong>{report.publishedAt}</strong></>}
            </div>
            <div className="cp-report-action-row">
              {isDraft ? (
                <>
                  <Button variant="outline" size="sm">Preview</Button>
                  <Button variant="outline" size="sm">Replace</Button>
                  <ReportConfirmation type="publish" report={report} trigger={<Button size="sm">Publish</Button>} />
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm">View</Button>
                  <ReportConfirmation type="replace" report={report} trigger={<Button variant="outline" size="sm">Replace version</Button>} />
                  <ReportConfirmation type="archive" report={report} trigger={<Button variant="outline" size="sm">Archive</Button>} />
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AdminReportsExperience() {
  const draftReport = reports.find((report) => report.id === 'q3-2026');
  const publishedReport = reports.find((report) => report.id === 'q2-2026');

  return (
    <section className="cp-report-experience">
      <div className="cp-report-admin-header">
        <div>
          <div className="cp-label text-primary">Admin experience</div>
          <h2 className="cp-section-title">Quarterly Reports</h2>
          <p>Prepare, review and publish reconciled financial reports for club members.</p>
        </div>
        <Button><UploadCloud size={14} /> Upload report</Button>
      </div>

      <div className="cp-admin-report-states">
        <AdminReportStateCard state="empty" />
        <AdminReportStateCard report={draftReport} />
        <AdminReportStateCard report={publishedReport} />
      </div>

      <QuarterlyReportList
        title="Report management"
        description="Complete lifecycle view for Admin only."
        reports={reports.filter((report) => ['q3-2026', 'q2-2026', 'q1-2026', 'q4-2025'].includes(report.id))}
        audience="admin"
      />

      <div className="cp-report-admin-actions">
        <ReportDetailSheet
          audience="admin"
          report={draftReport}
          trigger={<Button variant="outline"><FileClock size={14} /> Open draft detail Sheet</Button>}
        />
        <ReportConfirmation type="publish" report={draftReport} trigger={<Button>Open publish confirmation</Button>} />
        <ReportConfirmation type="replace" report={publishedReport} trigger={<Button variant="outline">Open replace confirmation</Button>} />
        <ReportConfirmation type="archive" report={reports.find((report) => report.id === 'q4-2025')} trigger={<Button variant="outline">Open archive confirmation</Button>} />
      </div>
    </section>
  );
}

function ReportsShowcase() {
  return (
    <div className="cp-reports-showcase">
      <MemberReportsExperience />
      <AdminReportsExperience />
    </div>
  );
}

function TokenSwatches() {
  const swatches = [['Ink', 'bg-background'], ['Surface', 'bg-surface'], ['Elevated', 'bg-surface-elevated'], ['Accent', 'bg-primary'], ['Success', 'bg-success'], ['Warning', 'bg-warning'], ['Danger', 'bg-danger'], ['Info', 'bg-info']];
  return <div className="cp-token-grid">{swatches.map(([label, color]) => <div key={label} className="cp-token-card"><div className={`cp-token-swatch ${color}`} /><div>{label}</div></div>)}</div>;
}

function ComponentGallery() {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <div className="cp-component-gallery">
      <Card className="cp-panel">
        <CardHeader><CardTitle>Refined primitives</CardTitle><CardDescription>Shared shadcn primitives through Checkpoint premium tokens.</CardDescription></CardHeader>
        <CardContent className="cp-component-stack">
          <div className="cp-component-row"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Destructive</Button></div>
          <div className="cp-component-row"><StatusBadge status="Active" /><StatusBadge status="Review" /><StatusBadge status="Overdue" /><StatusBadge status="Info" /><Badge variant="neutral">Neutral</Badge></div>
          <div className="cp-form-grid"><div><Label htmlFor="sample-email">Email</Label><Input id="sample-email" placeholder="amina@example.com" /></div><div><Label>Fiscal year</Label><Select defaultValue="2026"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="2026">FY2026</SelectItem><SelectItem value="2025">FY2025</SelectItem></SelectContent></Select></div><div className="cp-avatar-demo"><Label>Avatar</Label><Avatar><AvatarFallback>AE</AvatarFallback></Avatar></div></div>
          <div className="cp-component-row">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogTrigger asChild><Button variant="outline">Open Dialog</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Record review note</DialogTitle><DialogDescription>Focused and reversible workflow surface.</DialogDescription></DialogHeader><Input placeholder="Optional note" /><DialogFooter><Button variant="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={() => setDialogOpen(false)}>Save note</Button></DialogFooter></DialogContent></Dialog>
            <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="ghost">Tooltip</Button></TooltipTrigger><TooltipContent>Helpful, but quiet.</TooltipContent></Tooltip></TooltipProvider>
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">Actions <MoreHorizontal size={14} /></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Export CSV</DropdownMenuItem><DropdownMenuItem>Open audit history</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          </div>
        </CardContent>
      </Card>
      <Card className="cp-panel"><CardHeader><CardTitle>Tokens</CardTitle><CardDescription>Contextual surfaces, accents and semantic status colors.</CardDescription></CardHeader><CardContent><TokenSwatches /></CardContent></Card>
      <Card className="cp-panel"><CardHeader><CardTitle>Loading and empty states</CardTitle></CardHeader><CardContent className="cp-component-stack"><div className="cp-form-grid"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div><EmptyState icon={Mail} title="No invitations pending" description="Member invitations will appear here after an admin creates them." /></CardContent></Card>
      <DetailSheet trigger={<Button variant="outline">Open reusable DetailSheet</Button>} title="Amina Example" subtitle="Member account preview" status="Good" summary={[{ label: 'Contribution', value: 'TZS 900K' }, { label: 'Loan balance', value: 'TZS 250K' }]} sections={[{ title: 'Account coverage', content: 'Linked user account, email, and phone fields can be reviewed here in a future sprint.' }]} activity={activity} />
    </div>
  );
}

export default function DesignSystem() {
  return (
    <div className="cp-design-system cp-theme-admin cp-showcase-shell">
      <div className="cp-showcase-inner">
        <header className="cp-showcase-header">
          <div><div className="cp-label text-primary">Checkpoint design system</div><h1 className="cp-page-title">Premium visual direction</h1><p>Showroom-only application language for a restrained financial SaaS product. Dummy data only.</p></div>
          <Button variant="outline" asChild><a href="/">Back to app</a></Button>
        </header>
        <Tabs defaultValue="admin" className="cp-showroom-tabs">
          <ShowroomSwitcher />
          <TabsContent value="admin"><AdminSample /></TabsContent>
          <TabsContent value="member"><MemberSample /></TabsContent>
          <TabsContent value="auth"><AuthSample /></TabsContent>
          <TabsContent value="charts"><ChartsShowcase /></TabsContent>
          <TabsContent value="reports"><ReportsShowcase /></TabsContent>
          <TabsContent value="components"><ComponentGallery /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
