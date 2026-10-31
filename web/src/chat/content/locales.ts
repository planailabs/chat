import type { ChatModeId } from '../api';

export type LocaleKey = 'en' | 'de';

export interface StreamConfig {
  initialDelayMs: number;
  chunkSize: number;
  intervalMs: number;
}

export interface ChatModeLocale {
  heroBadgeLabel: string;
  heading: string;
  placeholder: string;
  cancelLabel: string;
  configuringLabel: string;
  /** Sent for the user when the conversation is empty ('' = none). */
  greeting: string;
}

export interface PreferencePromptLocale {
  question: string;
  ctaYesLabel: string;
  ctaNoLabel: string;
  confirmText: string;
  declineText: string;
  stream: StreamConfig;
}

export interface LocaleContent {
  languageNativeName: string;
  locale: string;
  navigation: {
    themeToggle: {
      label: string;
      tooltip: string;
    };
    languageMenu: {
      label: string;
      tooltip: string;
    };
    loginMenu: {
      labelLoggedOut: string;
      signOutLabel: string;
    };
    settingsLabel: string;
    newConversationLabel: string;
  };
  composer: {
    submitLabel: string;
  };
  chat: {
    /** Shown to anonymous users after their first prompt. */
    loginInvite: {
      text: string;
      stream: StreamConfig;
    };
    approval: {
      title: string;
      approve: string;
      deny: string;
      approveAll: string;
      approved: string;
      denied: string;
      requested: string;
    };
    errors: {
      rateLimited: string;
      tooLong: string;
      unavailable: string;
      readOnly: string;
      signedOut: string;
      generic: string;
    };
  };
  settings: {
    title: string;
    sections: {
      profile: {
        title: string;
        fields: {
          name: string;
          newsletter: string;
        };
      };
      privacy: {
        title: string;
        requestData: string;
        requestDataStarted: string;
        requestDataDone: string;
        requestDataError: string;
        deleteAccount: string;
        deleteConfirmation: string;
        deleteScheduledInfo: string;
        deletePendingLogin: string;
        deleteError: string;
      };
    };
    savedLabel: string;
  };
  footer: {
    consent: string;
    termsLabel: string;
    privacyLabel: string;
    termsUrl: string;
    privacyUrl: string;
  };
  chatModes: Record<ChatModeId, ChatModeLocale>;
  preferencePrompts: Record<string, PreferencePromptLocale>;
}

const defaultStream: StreamConfig = {
  initialDelayMs: 480,
  chunkSize: 3,
  intervalMs: 28,
};

const en: LocaleContent = {
  languageNativeName: 'English',
  locale: 'en-US',
  navigation: {
    themeToggle: {
      label: 'Theme',
      tooltip: 'Switch design',
    },
    languageMenu: {
      label: 'Language',
      tooltip: 'Switch language',
    },
    loginMenu: {
      labelLoggedOut: 'Sign in',
      signOutLabel: 'Sign out',
    },
    settingsLabel: 'Settings',
    newConversationLabel: 'New conversation',
  },
  composer: {
    submitLabel: 'Send',
  },
  chat: {
    loginInvite: {
      text: 'Please sign in to chat with our assistant.',
      stream: defaultStream,
    },
    approval: {
      title: 'Approval needed',
      approve: 'Approve',
      deny: 'Deny',
      approveAll: 'Approve all in this conversation',
      approved: 'Approved',
      denied: 'Denied',
      requested: 'Approval requested',
    },
    errors: {
      rateLimited: 'You’ve reached the hourly message limit. Please try again later.',
      tooLong: 'This message is too long. Please shorten it.',
      unavailable: 'This chat isn’t available for your account.',
      readOnly: 'Read-only while impersonating.',
      signedOut: 'Your session has expired. Please sign in again.',
      generic: 'Something went wrong. Please try again.',
    },
  },
  settings: {
    title: 'Settings',
    sections: {
      profile: {
        title: 'Newsletter & Updates',
        fields: {
          name: 'Your name',
          newsletter: 'Subscribe to newsletter',
        },
      },
      privacy: {
        title: 'Privacy & Data',
        requestData: 'Request all your user data',
        requestDataStarted: 'Download started…',
        requestDataDone: 'Download done',
        requestDataError:
          'Unable to export data right now. Please try again in a moment.',
        deleteAccount: 'Delete account (completely)',
        deleteConfirmation:
          'Are you sure? Your account will be scheduled for deletion within 30 days and you will not be able to sign in during that time.',
        deleteScheduledInfo:
          'Account scheduled for deletion. You cannot sign in during this period.',
        deletePendingLogin:
          'This account is scheduled for deletion and cannot be accessed. Please wait or contact support.',
        deleteError:
          'Unable to schedule account deletion right now. Please try again.',
      },
    },
    savedLabel: 'Saved',
  },
  footer: {
    consent:
      'By using this service, you agree to our Terms&nbsp;and&nbsp;Privacy&nbsp;Policy.',
    termsLabel: 'Terms',
    privacyLabel: 'Privacy&nbsp;Policy',
    termsUrl: '/legal-en.md',
    privacyUrl: '/legal-en.md',
  },
  chatModes: {
    machine_config: {
      heroBadgeLabel: 'Machine configuration',
      heading: 'What should your Mac do?',
      placeholder: 'Install dev tools, add MCP servers, show my config...',
      cancelLabel: 'Skip',
      configuringLabel: 'Configuring…',
      greeting: 'Hello',
    },
    sales: {
      heroBadgeLabel: 'Sales',
      heading: 'How can we help your team?',
      placeholder: 'Tell us about your Mac fleet...',
      cancelLabel: 'Skip',
      configuringLabel: 'Thinking…',
      greeting: '',
    },
  },
  preferencePrompts: {
    newsletter: {
      question: 'Would you like to subscribe to our newsletter to stay updated on new features and upgrades?',
      ctaYesLabel: 'Yes, please',
      ctaNoLabel: 'No, thank you',
      confirmText: 'Great, you\'re on the list! We\'ll keep you updated.',
      declineText: 'No problem. You can always subscribe later in settings.',
      stream: defaultStream,
    },
  },
};

const de: LocaleContent = {
  languageNativeName: 'Deutsch',
  locale: 'de-DE',
  navigation: {
    themeToggle: {
      label: 'Theme',
      tooltip: 'Design wechseln',
    },
    languageMenu: {
      label: 'Sprache',
      tooltip: 'Sprache wechseln',
    },
    loginMenu: {
      labelLoggedOut: 'Anmelden',
      signOutLabel: 'Abmelden',
    },
    settingsLabel: 'Einstellungen',
    newConversationLabel: 'Neues Gespräch',
  },
  composer: {
    submitLabel: 'Senden',
  },
  chat: {
    loginInvite: {
      text: 'Bitte melde dich an, um mit unserem Assistenten zu chatten.',
      stream: defaultStream,
    },
    approval: {
      title: 'Freigabe erforderlich',
      approve: 'Freigeben',
      deny: 'Ablehnen',
      approveAll: 'Alles in diesem Gespräch freigeben',
      approved: 'Freigegeben',
      denied: 'Abgelehnt',
      requested: 'Freigabe angefragt',
    },
    errors: {
      rateLimited: 'Du hast das stündliche Nachrichtenlimit erreicht. Bitte versuche es später noch einmal.',
      tooLong: 'Diese Nachricht ist zu lang. Bitte kürze sie.',
      unavailable: 'Dieser Chat ist für dein Konto nicht verfügbar.',
      readOnly: 'Beim Impersonieren ist nur Lesen möglich.',
      signedOut: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
      generic: 'Etwas ist schiefgelaufen. Bitte versuche es noch einmal.',
    },
  },
  settings: {
    title: 'Einstellungen',
    sections: {
      profile: {
        title: 'Profil',
        fields: {
          name: 'Dein Name',
          newsletter: 'Newsletter abonnieren',
        },
      },
      privacy: {
        title: 'Datenschutz',
        requestData: 'Nutzerdaten anfordern',
        requestDataStarted: 'Download gestartet…',
        requestDataDone: 'Download abgeschlossen',
        requestDataError:
          'Datenexport im Moment nicht möglich. Bitte versuche es gleich noch einmal.',
        deleteAccount: 'Konto vollständig löschen',
        deleteConfirmation:
          'Bist du sicher? Dein Konto wird innerhalb von 30 Tagen zur Löschung eingeplant und du kannst dich in dieser Zeit nicht anmelden.',
        deleteScheduledInfo:
          'Dieses Konto wurde zur Löschung eingeplant. Eine erneute Anmeldung ist bis dahin nicht möglich.',
        deletePendingLogin:
          'Dieses Konto ist zur Löschung vorgesehen. Bitte warte oder kontaktiere den Support.',
        deleteError:
          'Die Kontolöschung kann gerade nicht eingeplant werden. Bitte versuche es noch einmal.',
      },
    },
    savedLabel: 'Gespeichert',
  },
  footer: {
    consent:
      'Durch die Nutzung stimmst du unseren Nutzungsbedingungen und Datenschutzrichtlinien&nbsp;zu.',
    termsLabel: 'Nutzungsbedingungen',
    privacyLabel: 'Datenschutzrichtlinien',
    termsUrl: '/legal-de.md',
    privacyUrl: '/legal-de.md',
  },
  chatModes: {
    machine_config: {
      heroBadgeLabel: 'Maschinenkonfiguration',
      heading: 'Was soll dein Mac können?',
      placeholder: 'Dev-Tools installieren, MCP-Server hinzufügen, Config anzeigen...',
      cancelLabel: 'Überspringen',
      configuringLabel: 'Konfiguriere…',
      greeting: 'Hallo',
    },
    sales: {
      heroBadgeLabel: 'Vertrieb',
      heading: 'Wie können wir deinem Team helfen?',
      placeholder: 'Erzähl uns von deiner Mac-Flotte...',
      cancelLabel: 'Überspringen',
      configuringLabel: 'Denke nach…',
      greeting: '',
    },
  },
  preferencePrompts: {
    newsletter: {
      question: 'Möchtest du unseren Newsletter abonnieren, um über neue Features und Upgrades informiert zu bleiben?',
      ctaYesLabel: 'Ja, bitte',
      ctaNoLabel: 'Nein, danke',
      confirmText: 'Super, du bist dabei! Wir halten dich auf dem Laufenden.',
      declineText: 'Kein Problem. Du kannst jederzeit in den Einstellungen abonnieren.',
      stream: defaultStream,
    },
  },
};

export const locales: Record<LocaleKey, LocaleContent> = {
  en,
  de,
};

export const supportedLocales: LocaleKey[] = Object.keys(
  locales,
) as LocaleKey[];

export const defaultLocale: LocaleKey = 'en';
