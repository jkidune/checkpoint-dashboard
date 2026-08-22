import { Download, Eye, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReportStatusBadge } from './ReportStatusBadge';
import { cn } from '@/lib/utils';

export function QuarterlyReportBanner({ report, variant = 'notice', viewed = false, className }) {
  const isAccent = variant === 'accent';

  return (
    <section className={cn('cp-report-banner', isAccent && 'is-accent', viewed && 'is-viewed', className)}>
      <div className="cp-report-banner-icon">
        <FileText size={18} />
      </div>
      <div className="cp-report-banner-copy">
        <div className="cp-report-banner-kicker">
          {report.quarter} {report.year} report
          <ReportStatusBadge status={viewed ? 'viewed' : 'new'}>{viewed ? 'Viewed' : 'New'}</ReportStatusBadge>
        </div>
        <h3>{viewed ? report.title : `Your ${report.quarter} ${report.year} quarterly report is ready.`}</h3>
        <p>Reconciled through {report.cutoffDate} · Published {report.publishedAt}</p>
      </div>
      <div className="cp-report-banner-actions">
        <Button variant={viewed ? 'outline' : 'default'} size="sm">
          <Eye size={14} /> View report
        </Button>
        <Button variant="outline" size="sm">
          <Download size={14} /> Download PDF
        </Button>
      </div>
    </section>
  );
}
