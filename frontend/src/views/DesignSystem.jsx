import { useState } from 'react';
import {
  AlertTriangle, ArrowRight, Banknote, Bell, CircleDollarSign, Command,
  CreditCard, Download, HandCoins, HelpCircle, Home, Landmark, LineChart,
  Mail, MoreHorizontal, PiggyBank, Receipt, Search, Settings, ShieldCheck,
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
import { ActivityTimeline, DetailSheet, EmptyState, MetricCard, MoneyStat, StatusBadge } from '@/components/checkpoint';

const navItems = [
  ['Overview', Home],
  ['Contributions', HandCoins],
  ['Loans', Banknote],
  ['Members', UsersRound],
  ['Transactions', Receipt],
  ['Investments', LineChart],
  ['Expenses', CreditCard],
];

const activity = [
  { title: 'Contribution corrected', meta: '22 Aug · Admin', description: 'Reference and amount reconciled before approval.' },
  { title: 'Contact information updated', meta: '18 Aug · Secretary' },
  { title: 'Loan repayment recorded', meta: '12 Aug · Treasurer' },
];

const loans = [
  ['Amina Example', 'TZS 1,200,000', 'TZS 620,000', '05 Sep 2026', 'Active'],
  ['Daniel Example', 'TZS 900,000', 'TZS 220,000', 'Overdue', 'Overdue'],
  ['Neema Example', 'TZS 650,000', 'TZS 140,000', '14 Sep 2026', 'Review'],
  ['Peter Example', 'TZS 400,000', 'TZS 0', 'Closed', 'Paid'],
];

function ShowroomSwitcher() {
  return (
    <TabsList className="cp-showroom-switcher">
      <TabsTrigger value="admin">Admin</TabsTrigger>
      <TabsTrigger value="member">Member</TabsTrigger>
      <TabsTrigger value="auth">Auth</TabsTrigger>
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
      <nav className="cp-admin-nav" aria-label="Showroom navigation">
        {navItems.map(([label, Icon], index) => (
          <button key={label} className={`cp-admin-nav-item ${index === 0 ? 'is-active' : ''}`} type="button">
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="cp-admin-sidebar-secondary">
        <button className="cp-admin-nav-item" type="button"><Settings size={15} />Settings</button>
        <button className="cp-admin-nav-item" type="button"><HelpCircle size={15} />Help</button>
      </div>
    </aside>
  );
}

function AdminHeader() {
  return (
    <header className="cp-admin-header">
      <div>
        <div className="cp-label text-primary">Checkpoint Investment Club</div>
        <h1 className="cp-page-title">Overview</h1>
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
        <Avatar className="size-8"><AvatarFallback>JM</AvatarFallback></Avatar>
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
          <div className="cp-finance-card-topline"><span>Club Equity</span><Landmark size={17} /></div>
          <div className="cp-hero-money">TZS 15.54M</div>
          <div className="cp-finance-meta"><TrendingUp size={13} /> +4.2% since prior close · reconciled 22 Aug</div>
        </CardContent>
      </Card>
      <div className="cp-supporting-metrics">
        <MoneyStat title="Cash at Bank" value="TZS 8.20M" supportingText="M-Koba confirmed" icon={PiggyBank} />
        <MoneyStat title="Loans Outstanding" value="TZS 4.15M" supportingText="Principal balance" icon={Banknote} />
        <MoneyStat title="Contributions YTD" value="TZS 3.19M" trend={{ direction: 'up', value: '+8.1%' }} supportingText="FY2026 paid" icon={CircleDollarSign} />
      </div>
    </section>
  );
}

function FinancialPosition() {
  return (
    <Card className="cp-panel">
      <CardHeader>
        <div>
          <CardTitle>Financial position</CardTitle>
          <CardDescription>Dummy monthly trend placeholder for visual direction.</CardDescription>
        </div>
        <Badge variant="neutral">FY2026</Badge>
      </CardHeader>
      <CardContent>
        <div className="cp-chart-placeholder">
          {[42, 48, 44, 57, 61, 66, 72, 76].map((height, index) => (
            <div key={index} className="cp-chart-bar" style={{ height: `${height}%` }} />
          ))}
          <div className="cp-chart-line" />
        </div>
      </CardContent>
    </Card>
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
        <div><CardTitle>Active loans</CardTitle><CardDescription>Premium table sample for dense financial operations.</CardDescription></div>
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
            {loans.map(([member, principal, outstanding, payment, status]) => (
              <TableRow key={member}>
                <TableCell><div className="cp-member-cell"><Avatar className="size-7"><AvatarFallback>{member.split(' ').map((part) => part[0]).join('')}</AvatarFallback></Avatar><span>{member}</span></div></TableCell>
                <TableCell className="text-right tabular-nums">{principal}</TableCell>
                <TableCell className="text-right tabular-nums">{outstanding}</TableCell>
                <TableCell>{payment}</TableCell>
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
        <div className="cp-admin-grid"><FinancialPosition /><RequiresAttention /></div>
        <div className="cp-admin-grid cp-admin-grid-bottom"><ActiveLoansTable /><Card className="cp-panel"><CardHeader><div><CardTitle>Recent activity</CardTitle><CardDescription>Compact audit feed sample.</CardDescription></div></CardHeader><CardContent><ActivityTimeline items={activity} /></CardContent></Card></div>
      </main>
    </section>
  );
}

function MemberSample() {
  return (
    <section className="cp-design-system cp-theme-member cp-member-showroom">
      <div className="cp-member-hero">
        <div><div className="cp-label text-primary">Member experience</div><h2 className="cp-page-title">Good evening, Amina</h2><p>Quiet personal finance surfaces with warmer spacing and fewer competing controls.</p></div>
        <Button variant="outline">View statement</Button>
      </div>
      <div className="cp-member-cards">
        <MoneyStat title="My Contributions" value="TZS 900,000" supportingText="FY2026 paid" icon={CircleDollarSign} tone="primary" />
        <MoneyStat title="Loan Balance" value="TZS 250,000" supportingText="Due in 42 days" icon={Banknote} />
        <MetricCard label="Standing" value="Good" description="No overdue fines or missed periods." icon={ShieldCheck} />
      </div>
      <Card className="cp-member-panel"><CardContent><div className="cp-member-reminder"><Bell size={18} /><div><strong>No new alerts</strong><span>Your contribution and loan reminders will appear here.</span></div></div></CardContent></Card>
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
          <TabsContent value="components"><ComponentGallery /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
