export default function PriorityBadge({ score }: { score: number }) {
  return score >= 0.8
    ? <span className="priority-badge">Высокий приоритет</span>
    : null;
}
