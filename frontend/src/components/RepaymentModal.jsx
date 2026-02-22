// frontend/src/components/RepaymentModal.jsx
import React, { useState } from 'react';
import api from '../api'; // Assuming you have an axios instance setup

export default function RepaymentModal({ loan, onClose, onRepaymentSuccess }) {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);

  // If the loan is already paid, don't show the form
  const isPaid = loan.Status === 'Paid';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Calls the Express backend route we designed earlier
      const response = await api.post(`/api/loans/${loan.id}/repay`, {
        member_id: loan.member_id,
        amount: parseFloat(amount),
        mpesa_reference: reference
      });
      
      // Tell the parent component to refresh the data
      onRepaymentSuccess(response.data);
      onClose();
    } catch (error) {
      console.error("Repayment failed", error);
      alert("Failed to record repayment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#0f172a] border border-gray-800 p-6 rounded-xl w-full max-w-md text-white">
        <h2 className="text-xl font-bold mb-4">Loan Details - {loan.Member}</h2>
        
        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <p className="text-gray-400">Principal</p>
            <p className="font-semibold text-[#38bdf8]">{loan.Principal}</p>
          </div>
          <div>
            <p className="text-gray-400">Current Balance</p>
            <p className="font-semibold text-[#f87171]">{loan.Balance}</p>
          </div>
        </div>

        {!isPaid && (
          <form onSubmit={handleSubmit} className="space-y-4 border-t border-gray-800 pt-4">
            <div>
              <label className="block text-gray-400 text-sm mb-1">Repayment Amount (TZS)</label>
              <input 
                type="number" 
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-[#1e293b] border border-gray-700 rounded p-2 text-white"
                required
                max={loan.raw_balance} // Prevent overpaying
              />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">MPesa Reference</label>
              <input 
                type="text" 
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full bg-[#1e293b] border border-gray-700 rounded p-2 text-white"
                required
              />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded text-gray-400 hover:text-white">Cancel</button>
              <button type="submit" disabled={loading} className="bg-[#0ea5e9] hover:bg-[#0284c7] px-4 py-2 rounded font-semibold transition-colors">
                {loading ? 'Processing...' : 'Record Repayment'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}