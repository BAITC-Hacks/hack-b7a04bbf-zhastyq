import type { Role } from '../../shared/contracts';

export const roleLabels: Record<Role, string> = {
  consolidator: 'Консолидация',
  transit: 'Транзит',
  distributor: 'Распределение',
  terminal: 'Конечный получатель',
  coordinator: 'Координация',
  peripheral: 'Периферия',
};

export const formatMoney = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₸';

export const formatScore = (value: number) => value.toFixed(2).replace('.', ',');
