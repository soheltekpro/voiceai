import { Card, CardContent } from '../../components/ui/card';

type Props = { title: string; description?: string };

export function PlaceholderPage({ title, description }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description && <p className="text-slate-600 mt-1">{description}</p>}
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <p className="text-slate-500">This section is coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
