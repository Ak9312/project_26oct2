import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div>
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-muted-foreground">The page you're looking for doesn't exist.</p>
        <Button asChild className="mt-6"><Link to="/">Go to audits</Link></Button>
      </div>
    </div>
  );
}
