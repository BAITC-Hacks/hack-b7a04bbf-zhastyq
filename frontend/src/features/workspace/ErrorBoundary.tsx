import { Component, type ReactNode } from 'react';

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="app-recovery"><p className="eyebrow">ZHASTYQ / AML WORKSPACE</p><h1>Не удалось открыть рабочее пространство</h1><p>Перезагрузите страницу, чтобы восстановить интерфейс. Выбранные локальные файлы потребуется добавить повторно.</p><button type="button" className="primary-button" onClick={() => window.location.reload()}>Перезагрузить страницу</button></main>;
    return this.props.children;
  }
}
