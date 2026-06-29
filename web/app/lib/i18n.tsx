'use client';

import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';

export type AppLanguage = 'en' | 'es' | 'fr';

type TranslationMap = Record<string, string>;

const translations: Record<AppLanguage, TranslationMap> = {
  en: {
    'nav.markets': 'Markets',
    'nav.create': 'Create',
    'nav.transactions': 'Transactions',
    'nav.activity': 'Activity',
    'nav.dashboard': 'Dashboard',
    'nav.analytics': 'Analytics',
    'nav.settings': 'Settings',
    'nav.connectWallet': 'Connect wallet',
    'nav.signOut': 'Sign out',
    'dashboard.title': 'Dashboard',
    'dashboard.subtitle': 'Your betting statistics and activity',
    'dashboard.connectPromptTitle': 'Connect Wallet to View Dashboard',
    'dashboard.connectPromptBody': 'Connect your wallet to see your betting history and statistics.',
    'dashboard.refresh': 'Refresh Data',
    'dashboard.refreshing': 'Refreshing...',
    'dashboard.overview': 'Overview',
    'dashboard.activeBets': 'Active Bets',
    'dashboard.history': 'History',
    'dashboard.incentives': 'Incentives',
    'dashboard.recentActivity': 'Recent Activity',
    'dashboard.noBets': 'No bets yet. Start betting to see your activity here.',
    'dashboard.noActiveBets': 'No active bets.',
    'dashboard.noHistory': 'No history yet.',
    'dashboard.totalBets': 'Total Bets',
    'dashboard.totalWagered': 'Total Wagered',
    'dashboard.totalWinnings': 'Total Winnings',
    'dashboard.winRate': 'Win Rate',
    'dashboard.activeBetsCount': 'Active Bets',
    'dashboard.settledBetsCount': 'Settled Bets',
    'settings.title': 'Settings',
    'settings.subtitle': 'Personalize language, notifications, and exports.',
    'settings.language': 'Language',
    'settings.languageBody': 'Choose the interface language used across the app.',
    'settings.notifications': 'Push notifications',
    'settings.notificationsBody': 'Get browser alerts for claims, bet updates, and pool changes.',
    'settings.notificationsOn': 'Enabled',
    'settings.notificationsOff': 'Disabled',
    'settings.requestPermission': 'Enable notifications',
    'settings.testNotification': 'Send test notification',
    'settings.exportTitle': 'Exports',
    'settings.exportBody': 'Download pools and activity data in CSV or JSON.',
    'settings.exportPoolsCsv': 'Export pools CSV',
    'settings.exportPoolsJson': 'Export pools JSON',
    'settings.exportActivityCsv': 'Export activity CSV',
    'settings.exportActivityJson': 'Export activity JSON',
    'settings.loadingData': 'Loading data...',
    'settings.noWallet': 'Connect a wallet to export personal activity.',
    'settings.exportComplete': 'Export ready',
    'settings.exportFailed': 'Export failed',
    'settings.permissionGranted': 'Notification permission granted',
    'settings.permissionDenied': 'Notification permission denied',
  },
  es: {
    'nav.markets': 'Mercados',
    'nav.create': 'Crear',
    'nav.transactions': 'Transacciones',
    'nav.activity': 'Actividad',
    'nav.dashboard': 'Panel',
    'nav.analytics': 'Analíticas',
    'nav.settings': 'Ajustes',
    'nav.connectWallet': 'Conectar cartera',
    'nav.signOut': 'Cerrar sesión',
    'dashboard.title': 'Panel',
    'dashboard.subtitle': 'Tus estadísticas y actividad de apuestas',
    'dashboard.connectPromptTitle': 'Conecta la cartera para ver el panel',
    'dashboard.connectPromptBody': 'Conecta tu cartera para ver tu historial y estadísticas.',
    'dashboard.refresh': 'Actualizar datos',
    'dashboard.refreshing': 'Actualizando...',
    'dashboard.overview': 'Resumen',
    'dashboard.activeBets': 'Apuestas activas',
    'dashboard.history': 'Historial',
    'dashboard.incentives': 'Incentivos',
    'dashboard.recentActivity': 'Actividad reciente',
    'dashboard.noBets': 'Aún no hay apuestas. Empieza a apostar para ver tu actividad aquí.',
    'dashboard.noActiveBets': 'No hay apuestas activas.',
    'dashboard.noHistory': 'Todavía no hay historial.',
    'dashboard.totalBets': 'Apuestas totales',
    'dashboard.totalWagered': 'Total apostado',
    'dashboard.totalWinnings': 'Ganancias totales',
    'dashboard.winRate': 'Tasa de acierto',
    'dashboard.activeBetsCount': 'Apuestas activas',
    'dashboard.settledBetsCount': 'Apuestas liquidadas',
    'settings.title': 'Ajustes',
    'settings.subtitle': 'Personaliza idioma, notificaciones y exportaciones.',
    'settings.language': 'Idioma',
    'settings.languageBody': 'Elige el idioma de la interfaz en toda la app.',
    'settings.notifications': 'Notificaciones push',
    'settings.notificationsBody': 'Recibe alertas del navegador para cobros, apuestas y cambios de mercado.',
    'settings.notificationsOn': 'Activadas',
    'settings.notificationsOff': 'Desactivadas',
    'settings.requestPermission': 'Activar notificaciones',
    'settings.testNotification': 'Enviar notificación de prueba',
    'settings.exportTitle': 'Exportaciones',
    'settings.exportBody': 'Descarga datos de mercados y actividad en CSV o JSON.',
    'settings.exportPoolsCsv': 'Exportar mercados CSV',
    'settings.exportPoolsJson': 'Exportar mercados JSON',
    'settings.exportActivityCsv': 'Exportar actividad CSV',
    'settings.exportActivityJson': 'Exportar actividad JSON',
    'settings.loadingData': 'Cargando datos...',
    'settings.noWallet': 'Conecta una cartera para exportar actividad personal.',
    'settings.exportComplete': 'Exportación lista',
    'settings.exportFailed': 'La exportación falló',
    'settings.permissionGranted': 'Permiso de notificaciones concedido',
    'settings.permissionDenied': 'Permiso de notificaciones denegado',
  },
  fr: {
    'nav.markets': 'Marchés',
    'nav.create': 'Créer',
    'nav.transactions': 'Transactions',
    'nav.activity': 'Activité',
    'nav.dashboard': 'Tableau de bord',
    'nav.analytics': 'Analytique',
    'nav.settings': 'Paramètres',
    'nav.connectWallet': 'Connecter le wallet',
    'nav.signOut': 'Déconnexion',
    'dashboard.title': 'Tableau de bord',
    'dashboard.subtitle': 'Vos statistiques et votre activité de paris',
    'dashboard.connectPromptTitle': 'Connectez le wallet pour voir le tableau de bord',
    'dashboard.connectPromptBody': 'Connectez votre wallet pour voir votre historique et vos statistiques.',
    'dashboard.refresh': 'Actualiser',
    'dashboard.refreshing': 'Actualisation...',
    'dashboard.overview': 'Aperçu',
    'dashboard.activeBets': 'Paris actifs',
    'dashboard.history': 'Historique',
    'dashboard.incentives': 'Incitations',
    'dashboard.recentActivity': 'Activité récente',
    'dashboard.noBets': 'Aucun pari pour le moment. Commencez à parier pour voir votre activité ici.',
    'dashboard.noActiveBets': 'Aucun pari actif.',
    'dashboard.noHistory': "Pas d'historique pour le moment.",
    'dashboard.totalBets': 'Paris totaux',
    'dashboard.totalWagered': 'Total misé',
    'dashboard.totalWinnings': 'Gains totaux',
    'dashboard.winRate': 'Taux de victoire',
    'dashboard.activeBetsCount': 'Paris actifs',
    'dashboard.settledBetsCount': 'Paris réglés',
    'settings.title': 'Paramètres',
    'settings.subtitle': 'Personnalisez la langue, les notifications et les exports.',
    'settings.language': 'Langue',
    'settings.languageBody': "Choisissez la langue de l'interface dans l'application.",
    'settings.notifications': 'Notifications push',
    'settings.notificationsBody': 'Recevez des alertes navigateur pour les gains, mises à jour et changements de marché.',
    'settings.notificationsOn': 'Activées',
    'settings.notificationsOff': 'Désactivées',
    'settings.requestPermission': 'Activer les notifications',
    'settings.testNotification': 'Envoyer une notification test',
    'settings.exportTitle': 'Exports',
    'settings.exportBody': 'Téléchargez les données des marchés et de l’activité en CSV ou JSON.',
    'settings.exportPoolsCsv': 'Exporter les marchés CSV',
    'settings.exportPoolsJson': 'Exporter les marchés JSON',
    'settings.exportActivityCsv': 'Exporter l’activité CSV',
    'settings.exportActivityJson': 'Exporter l’activité JSON',
    'settings.loadingData': 'Chargement des données...',
    'settings.noWallet': 'Connectez un wallet pour exporter votre activité personnelle.',
    'settings.exportComplete': 'Export prêt',
    'settings.exportFailed': "L'export a échoué",
    'settings.permissionGranted': 'Autorisation des notifications accordée',
    'settings.permissionDenied': 'Autorisation des notifications refusée',
  },
};

export const supportedLanguages: Array<{ code: AppLanguage; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
];

export interface I18nContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (key: keyof typeof translations.en, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const STORAGE_KEY = 'predinex_language_v1';

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useLocalStorage<AppLanguage>(STORAGE_KEY, 'en');

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  const t = useCallback(
    (key: keyof typeof translations.en, fallback?: string) => translations[language][key] ?? translations.en[key] ?? fallback ?? key,
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t,
    }),
    [language, setLanguage, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
