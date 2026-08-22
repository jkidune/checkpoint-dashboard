import { useState } from 'react';
import {
  AlertTriangle, ArrowUpRight, Banknote, Bell, ChevronDown, CircleDollarSign,
  Landmark, MoreHorizontal, PiggyBank, Receipt, Search, ShieldCheck, UserRound,
} from 'lucide-react';
import '../design-system.css';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { ActivityTimeline, DetailSheet, EmptyState, FilterBar, MetricCard, MoneyStat, PageHeader, StatusBadge } from '@/components/checkpoint';

const activity = [
  { title: 'Contribution corrected', meta: '22 Aug 2026 · Admin', description: 'Amount and reference reviewed before approval.' },
  { title: 'Member details updated', meta: '18 Aug 2026 · Admin' },
  { title: 'Account created', meta: '03 Jul 2026 · Admin' },
];

function TokenSwatches() {
  const swatches = [
    ['Background', 'bg-background'],
    ['Surface', 'bg-surface'],
    ['Muted', 'bg-surface-muted'],
    ['Primary', 'bg-primary'],
    ['Success', 'bg-success'],
    ['Warning', 'bg-warning'],
    ['Danger', 'bg-danger'],
    ['Info', 'bg-info'],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {swatches.map(([label, color]) => (
        <div key={label} className="rounded-md border border-border bg-surface p-3">
          <div className={`h-10 rounded ${color} border border-border`} />
          <div className="mt-2 text-xs font-semibold text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>
  );
}

function ComponentGallery() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Core primitives</CardTitle>
          <CardDescription>First-pass shadcn primitives with Checkpoint tokens.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="Good" />
            <StatusBadge status="Pending" />
            <StatusBadge status="Overdue" />
            <StatusBadge status="Info" />
            <Badge variant="neutral">Neutral</Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="sample-email">Email</Label>
              <Input id="sample-email" placeholder="amina@example.com" />
            </div>
            <div className="space-y-2">
              <Label>Fiscal year</Label>
              <Select defaultValue="2026">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2026">FY2026</SelectItem>
                  <SelectItem value="2025">FY2025</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Avatar</Label>
              <div className="flex items-center gap-3">
                <Avatar><AvatarFallback>AE</AvatarFallback></Avatar>
                <span className="text-sm text-muted-foreground">Amina Example</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild><Button variant="outline">Open Dialog</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record review note</DialogTitle>
                  <DialogDescription>Short workflow dialogs keep forms focused and reversible.</DialogDescription>
                </DialogHeader>
                <Input placeholder="Optional note" />
                <DialogFooter>
                  <Button variant="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button onClick={() => setDialogOpen(false)}>Save note</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="destructive">High-impact action</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm financial action</AlertDialogTitle>
                  <AlertDialogDescription>This pattern is reserved for destructive or high-impact admin workflows.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Confirm</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Sheet>
              <SheetTrigger asChild><Button variant="outline">Open Sheet</Button></SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Contribution detail</SheetTitle>
                  <SheetDescription>Future right-side review surface.</SheetDescription>
                </SheetHeader>
                <ActivityTimeline items={activity} />
              </SheetContent>
            </Sheet>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline">More <ChevronDown size={14} /></Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Export CSV</DropdownMenuItem>
                <DropdownMenuItem>Open audit history</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild><Button variant="ghost">Tooltip</Button></TooltipTrigger>
                <TooltipContent>Helpful, but not essential.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tables and loading states</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  ['Amina Example', 'Good', 'TZS 0'],
                  ['Daniel Example', 'Review', 'TZS 250,000'],
                  ['Neema Example', 'Pending', 'TZS 75,000'],
                ].map(([name, status, balance]) => (
                  <TableRow key={name}>
                    <TableCell className="font-semibold">{name}</TableCell>
                    <TableCell><StatusBadge status={status} /></TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{balance}</TableCell>
                    <TableCell className="text-right"><Button variant="ghost" size="icon"><MoreHorizontal size={16} /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminSample() {
  return (
    <section className="cp-design-system cp-theme-admin rounded-2xl border border-border p-5 shadow-checkpoint">
      <PageHeader
        eyebrow="Admin sample"
        title="Checkpoint Admin"
        description="Dense operational surfaces with calm hierarchy and restrained status color."
        actions={<Button variant="secondary">Review queue</Button>}
      />
      <div className="cp-sample-stat-grid">
        <MoneyStat title="Club Equity" value="TZS 15.54M" trend={{ direction: 'up', value: '+4.2%' }} supportingText="vs previous period" icon={Landmark} tone="primary" />
        <MoneyStat title="Cash at Bank" value="TZS 8.20M" supportingText="M-Koba confirmed" icon={PiggyBank} />
        <MoneyStat title="Loans Outstanding" value="TZS 4.15M" trend={{ direction: 'down', value: '-2.1%' }} supportingText="principal balance" icon={Banknote} />
      </div>
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Requires Attention</CardTitle>
          <CardDescription>Dummy presentation-only grouping for future Overview work.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            ['Amina Example', '3 issues'],
            ['Daniel Example', '1 issue'],
          ].map(([name, count]) => (
            <div key={name} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-muted p-3">
              <div>
                <div className="font-semibold">{name}</div>
                <div className="text-sm text-muted-foreground">{count}</div>
              </div>
              <Button variant="outline" size="sm">Review <ArrowUpRight size={13} /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function MemberSample() {
  return (
    <section className="cp-design-system cp-theme-member rounded-2xl border border-border p-5 shadow-checkpoint-soft">
      <PageHeader eyebrow="Member sample" title="Good evening, Amina" description="Friendly, light, mobile-first, and still financially precise." />
      <div className="cp-sample-stat-grid">
        <MoneyStat title="My Contributions" value="TZS 900,000" supportingText="FY2026 paid" icon={CircleDollarSign} tone="primary" />
        <MoneyStat title="Loan Balance" value="TZS 250,000" supportingText="Due in 42 days" icon={Banknote} />
        <MetricCard label="Standing" value="Good" description="No overdue fines or missed periods." icon={ShieldCheck} />
      </div>
      <EmptyState className="mt-5" icon={Bell} title="No new alerts" description="Your contribution and loan reminders will appear here." />
    </section>
  );
}

function AuthSample() {
  return (
    <section className="cp-design-system cp-theme-auth rounded-2xl border border-border p-5 shadow-checkpoint-soft">
      <div className="grid gap-8 lg:grid-cols-[1fr_420px] lg:items-center">
        <div>
          <div className="cp-label text-primary">Auth / onboarding sample</div>
          <h2 className="cp-display mt-4 max-w-2xl">Welcome back to Checkpoint</h2>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">Your club. Your contributions. Your financial history.</p>
        </div>
        <Card className="bg-surface-elevated">
          <CardHeader>
            <CardTitle>Sign in preview</CardTitle>
            <CardDescription>This is not wired to production auth.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="auth-email">Email</Label>
              <Input id="auth-email" placeholder="amina@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auth-password">Password</Label>
              <Input id="auth-password" type="password" placeholder="••••••••" />
            </div>
            <Button className="w-full">Sign in</Button>
            <Button variant="ghost" className="w-full">Activate member account</Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export default function DesignSystem() {
  return (
    <div className="cp-design-system cp-theme-admin cp-showcase-shell">
      <div className="cp-showcase-inner cp-showcase-stack">
        <PageHeader
          eyebrow="Checkpoint design system"
          title="Shared foundation preview"
          description="A temporary internal showroom for tokens, primitives, and Checkpoint-specific wrappers. Dummy data only."
          actions={<Button variant="outline" asChild><a href="/">Back to app</a></Button>}
        />

        <Tabs defaultValue="admin" className="space-y-6">
          <TabsList className="flex w-full justify-start overflow-x-auto md:w-fit">
            <TabsTrigger value="admin">Admin</TabsTrigger>
            <TabsTrigger value="member">Member</TabsTrigger>
            <TabsTrigger value="auth">Auth</TabsTrigger>
            <TabsTrigger value="components">Components</TabsTrigger>
          </TabsList>

          <TabsContent value="admin"><AdminSample /></TabsContent>
          <TabsContent value="member"><MemberSample /></TabsContent>
          <TabsContent value="auth"><AuthSample /></TabsContent>
          <TabsContent value="components" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Typography and tokens</CardTitle>
                <CardDescription>Shared scale and semantic color variables across theme contexts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <div className="cp-display">Display financial trust</div>
                  <div className="cp-page-title">Page title / dashboard heading</div>
                  <div className="cp-section-title">Section title</div>
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Body text uses a readable sans-serif. Financial amounts use tabular numerals and a consistent weight.</p>
                  <div className="cp-money">TZS 15.54M</div>
                </div>
                <Separator />
                <TokenSwatches />
              </CardContent>
            </Card>
            <ComponentGallery />
            <DetailSheet
              trigger={<Button variant="outline">Open reusable DetailSheet</Button>}
              title="Amina Example"
              subtitle="Member account preview"
              status="Good"
              summary={[
                { label: 'Contribution', value: 'TZS 900K' },
                { label: 'Loan balance', value: 'TZS 250K' },
              ]}
              sections={[
                { title: 'Account coverage', content: 'Linked user account, email, and phone fields can be reviewed here in a future sprint.' },
              ]}
              activity={activity}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
