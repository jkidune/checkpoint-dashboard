import { useState } from 'react';
import { Modal, showToast } from './UI';
import { imports } from '../api';

export default function ImportCsvModal({ type, onClose, onComplete }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return showToast('Please select a CSV file', 'error');

    const formData = new FormData();
    formData.append('file', file);

    setUploading(true);
    try {
      const res = await imports.csv(type, formData);
      showToast(`Successfully imported ${res.data.imported} records!`);
      if (onComplete) onComplete();
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Import failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const getTemplateContent = () => {
    if (type === 'members') return 'name,phone,role,status,join_date,entry_fee\nJohn Doe,0700000000,member,active,2025-01-01,100000';
    if (type === 'contributions') return 'member_id,amount,month,year,status,paid_date,mpesa_ref,notes\n1,75000,3,2025,paid,2025-03-01,QAB123,';
    if (type === 'loans') return 'member_id,loan_number,principal,issued_date,due_date,status,fiscal_year,notes\n1,Loan 1,1000000,2025-01-01,2025-06-01,active,2025,';
    return '';
  };

  const downloadTemplate = () => {
    const blob = new Blob([getTemplateContent()], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${type}.csv`;
    a.click();
  };

  return (
    <Modal title={`Import ${type.charAt(0).toUpperCase() + type.slice(1)}`} onClose={onClose}>
      <form onSubmit={handleUpload} className="modal-form">
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Upload a CSV file mapped to your members' numeric IDs. This will append new records to your database.
        </p>
        
        <div style={{ padding: '12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Unsure about formatting?</span>
            <button type="button" onClick={downloadTemplate} className="btn btn-ghost btn-sm" style={{ color: 'var(--accent-blue)' }}>
              Download Template
            </button>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 20 }}>
          <label>CSV File</label>
          <input 
            type="file" 
            accept=".csv" 
            onChange={e => setFile(e.target.files[0])} 
            className="form-input" 
            style={{ padding: '8px' }}
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={uploading}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
            {uploading ? 'Uploading...' : 'Import Data'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
