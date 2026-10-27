import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import './index.css';
import { TooltipProvider } from '@/components/ui';
import { Layout } from '@/components/layout';
import AuditsPage from '@/pages/Audits';
import NewAuditPage from '@/pages/NewAudit';
import ReportPage from '@/pages/Report';
import ReviewPage from '@/pages/Review';
import ValidationPage from '@/pages/Validation';
import NotFound from '@/pages/NotFound';

// Old links (/report.html?id=…) keep working.
function LegacyReport() {
  const [params] = useSearchParams();
  const id = params.get('id');
  return <Navigate to={id ? '/audits/' + encodeURIComponent(id) : '/'} replace />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<AuditsPage />} />
            <Route path="new" element={<NewAuditPage />} />
            <Route path="audits/:id" element={<ReportPage />} />
            <Route path="review" element={<ReviewPage />} />
            <Route path="validation" element={<ValidationPage />} />
            <Route path="report.html" element={<LegacyReport />} />
            <Route path="review.html" element={<Navigate to="/review" replace />} />
            <Route path="index.html" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  </React.StrictMode>
);
