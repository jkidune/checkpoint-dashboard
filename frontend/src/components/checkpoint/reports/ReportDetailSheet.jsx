import { Download, Eye, FileText, UploadCloud } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { ActivityTimeline } from '../ActivityTimeline';
import { ReportStatusBadge } from './ReportStatusBadge';

export function ReportDetailSheet({ report, trigger, audience = 'member', footer }) {
  const adminView = audience === 'admin';

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="cp-report-sheet">
        <SheetHeader>
          <div className="cp-report-sheet-title">
            <div className="cp-report-sheet-icon"><FileText size={18} /></div>
            <div>
              <SheetTitle>{report.title}</SheetTitle>
              <SheetDescription>{report.quarter} {report.year} quarterly report</SheetDescription>
            </div>
            <ReportStatusBadge status={report.status}>{report.status}</ReportStatusBadge>
          </div>
        </SheetHeader>

        <div className="cp-report-sheet-body">
          <div className="cp-report-definition-grid">
            <span>Reconciliation cutoff</span><strong>{report.cutoffDate}</strong>
            <span>Published</span><strong>{report.publishedAt || '—'}</strong>
            <span>Uploaded</span><strong>{report.uploadedAt || '—'}</strong>
            <span>Version</span><strong>v{report.version}</strong>
          </div>

          <Separator />

          <div className="cp-report-file-card">
            <FileText size={18} />
            <div>
              <strong>{report.filename}</strong>
              <span>{report.fileSize} · PDF document</span>
            </div>
          </div>

          {adminView && report.uploadedBy && (
            <>
              <Separator />
              <div className="cp-report-admin-identity">
                <Avatar className="size-9">
                  {report.uploadedBy.avatar && <AvatarImage src={report.uploadedBy.avatar} alt="" />}
                  <AvatarFallback>{report.uploadedBy.initials || 'JM'}</AvatarFallback>
                </Avatar>
                <div>
                  <strong>{report.uploadedBy.name}</strong>
                  <span>{report.uploadedBy.role}</span>
                </div>
              </div>
            </>
          )}

          <p className="cp-report-sheet-note">
            {adminView
              ? 'Admin history shows how this report moved through upload, replacement and publication review.'
              : "This report contains the club's reconciled quarterly financial position."}
          </p>

          {adminView && report.activity?.length > 0 && (
            <>
              <Separator />
              <div className="cp-report-sheet-section-title">Activity history</div>
              <ActivityTimeline items={report.activity} />
            </>
          )}
        </div>

        <SheetFooter>
          {footer || (
            <div className="cp-report-sheet-actions">
              <Button variant="outline"><Eye size={14} /> View report</Button>
              <Button><Download size={14} /> Download PDF</Button>
            </div>
          )}
          {adminView && report.status === 'draft' && (
            <div className="cp-report-sheet-actions">
              <Button variant="outline"><Eye size={14} /> Preview</Button>
              <Button variant="outline"><UploadCloud size={14} /> Replace</Button>
              <Button>Publish</Button>
            </div>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
