import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import OracleManagement from '../components/OracleManagement';

export default function OracleManagementPage() {
  return (
    <main className="min-h-screen bg-background text-foreground pt-20">
      <RouteErrorBoundary routeName="OracleManagement">
        <OracleManagement />
      </RouteErrorBoundary>
    </main>
  );
}
