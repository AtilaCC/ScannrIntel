'use client';
interface PlanBadgeProps {
  plan?: string;
}

export function PlanBadge({ plan = 'FREE' }: PlanBadgeProps) {
  const colors: Record<string, string> = {
    FREE: 'bg-gray-700 text-gray-300',
    PRO: 'bg-blue-600 text-white',
    ENTERPRISE: 'bg-purple-600 text-white',
  };
  return (
    <span className={`px-2 py-1 rounded text-xs font-semibold ${colors[plan] ?? colors.FREE}`}>
      {plan}
    </span>
  );
}
