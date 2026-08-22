import { Download, Eye, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ReportDetailSheet } from './ReportDetailSheet';
import { ReportStatusBadge } from './ReportStatusBadge';

export function QuarterlyReportList({ title = 'Quarterly Reports', description, reports = [], audience = 'member', groupByYear = false }) {
  const years = groupByYear
    ? [...new Set(reports.map((report) => report.year))]
    : [null];

  return (
    <Card className="cp-report-list-card">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent>
        {years.map((year) => {
          const rows = year ? reports.filter((report) => report.year === year) : reports;
          return (
            <div className="cp-report-year-group" key={year || 'all'}>
              {year && <div className="cp-report-year-heading">{year}</div>}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quarter</TableHead>
                    <TableHead>Report</TableHead>
                    <TableHead>{audience === 'admin' ? 'Cutoff' : 'Reconciliation cutoff'}</TableHead>
                    {audience === 'admin' && <TableHead>Version</TableHead>}
                    <TableHead>Published</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell className="cp-report-quarter-cell">{report.quarter}</TableCell>
                      <TableCell>
                        <div className="cp-report-name-cell">
                          <strong>{report.title}</strong>
                          <span>{report.filename}</span>
                        </div>
                      </TableCell>
                      <TableCell>{report.cutoffDate}</TableCell>
                      {audience === 'admin' && <TableCell>v{report.version}</TableCell>}
                      <TableCell>{report.publishedAt || '—'}</TableCell>
                      <TableCell><ReportStatusBadge status={report.status}>{report.status}</ReportStatusBadge></TableCell>
                      <TableCell className="text-right">
                        <div className="cp-report-row-actions">
                          <ReportDetailSheet
                            audience={audience}
                            report={report}
                            trigger={<Button variant="outline" size="sm"><Eye size={14} /> View</Button>}
                          />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`${report.quarter} ${report.year} report actions`}>
                                <MoreHorizontal size={15} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Report actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem><Eye size={14} /> View report</DropdownMenuItem>
                              <DropdownMenuItem><Download size={14} /> Download PDF</DropdownMenuItem>
                              {audience === 'admin' && <DropdownMenuItem>Open history</DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
