export type LocaleKey = 'en' | 'de';
type OAuthProviderName = 'google' | 'apple' | 'microsoft' | 'github';

export type ScenarioId = 'anonymousInvite' | 'postLoginNewsletter';

export interface StreamConfig {
  initialDelayMs: number;
  chunkSize: number;
  intervalMs: number;
}

type StepRole = 'assistant' | 'system';

export type StepCta =
  | {
      type: 'oauth_providers';
    }
  | {
      type: 'newsletter_prompt';
      positiveStepId: string;
      negativeStepId: string;
    };

export interface ConversationStep {
  id: string;
  role: StepRole;
  text: string;
  stream: StreamConfig;
  cta?: StepCta;
  nextStepId?: string;
}

export interface ConversationScenario {
  id: ScenarioId;
  entryStepId: string;
  steps: Record<string, ConversationStep>;
}

export interface LocaleContent {
  languageNativeName: string;
  locale: string;
  heroBadgeLabel: string;
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
      title: string;
      signOutLabel: string;
      providers: Partial<Record<OAuthProviderName, string>>;
    };
    settingsLabel: string;
  };
  composer: {
    heading: string;
    placeholder: string;
    submitLabel: string;
    maxCharacters: number;
    limitReachedLabel: string;
  };
  chat: {
    signedInWith: string;
    postLogin: {
      alreadySubscribedQuestion: string;
    };
    afterPrompt: {
      subscribedThanks: string;
      unsubscribedThanks: string;
    };
  };
  newsletter: {
    ctaYesLabel: string;
    ctaNoLabel: string;
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
  machineConfig: {
    heroBadgeLabel: string;
    heading: string;
    placeholder: string;
    cancelLabel: string;
    configuringLabel: string;
  };
  conversationScenarios: Record<ScenarioId, ConversationScenario>;
}

const defaultStream: StreamConfig = {
  initialDelayMs: 480,
  chunkSize: 3,
  intervalMs: 28,
};

const en: LocaleContent = {
  languageNativeName: 'English',
  locale: 'en-US',
  heroBadgeLabel: 'Get a plan by email',
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
      title: 'Sign in with…',
      signOutLabel: 'Sign out',
      providers: {
        // v1 ships with Google + GitHub only; keep entries nearby so adding
        // Apple/Microsoft in v2 is a single-line change.
        google: 'Google',
        github: 'GitHub',
      },
    },
    settingsLabel: 'Settings',
  },
  composer: {
    heading: 'What’s your next goal?',
    placeholder: "Let's create a plan...",
    submitLabel: 'Send',
    maxCharacters: 1024,
    limitReachedLabel: 'You’ve reached the {{max}} character limit.',
  },
  chat: {
    signedInWith: 'Signed in as {{email}}',
    postLogin: {
      alreadySubscribedQuestion:
        'Awesome, you’re on the list. We’ll let you know as soon as there’s something new.',
    },
    afterPrompt: {
      subscribedThanks:
        'Keep it coming! 🤩 We have a lot of requests at the moment, but we’ll send your plan as soon as possible by email...',
      unsubscribedThanks:
        'Thanks! We’ll email your plan as soon as it’s ready.',
    },
  },
  newsletter: {
    ctaYesLabel: 'Yes, please',
    ctaNoLabel: 'No, thank you',
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
  machineConfig: {
    heroBadgeLabel: 'Machine configuration',
    heading: 'What should your Mac do?',
    placeholder: 'Install dev tools, add MCP servers, show my config...',
    cancelLabel: 'Skip',
    configuringLabel: 'Configuring…',
  },
  conversationScenarios: {
    anonymousInvite: {
      id: 'anonymousInvite',
      entryStepId: 'invite-intro',
      steps: {
        'invite-intro': {
          id: 'invite-intro',
          role: 'assistant',
          text: 'Please sign in, so we can send you the plan as soon as possible by mail.',
          stream: defaultStream,
          cta: {
            type: 'oauth_providers',
          },
        },
      },
    },
    postLoginNewsletter: {
      id: 'postLoginNewsletter',
      entryStepId: 'newsletter-question',
      steps: {
        'newsletter-question': {
          id: 'newsletter-question',
          role: 'assistant',
          text: 'Thank you for signing in! We’ll email your plan in the next days. Get the newsletter to stay updated?',
          stream: defaultStream,
          cta: {
            type: 'newsletter_prompt',
            positiveStepId: 'newsletter-confirm',
            negativeStepId: 'newsletter-decline',
          },
        },
        'newsletter-reconsider': {
          id: 'newsletter-reconsider',
          role: 'assistant',
          text: 'Get the newsletter to stay on top of new features and upgrades?',
          stream: defaultStream,
          cta: {
            type: 'newsletter_prompt',
            positiveStepId: 'newsletter-confirm',
            negativeStepId: 'newsletter-decline',
          },
        },
        'newsletter-confirm': {
          id: 'newsletter-confirm',
          role: 'assistant',
          text: 'Perfect. We’ll email your plan and keep you updated.',
          stream: defaultStream,
        },
        'newsletter-decline': {
          id: 'newsletter-decline',
          role: 'assistant',
          text: 'No problem. You will still get the plan by mail.',
          stream: defaultStream,
        },
      },
    },
  },
};

const de: LocaleContent = {
  languageNativeName: 'Deutsch',
  locale: 'de-DE',
  heroBadgeLabel: 'Optimierung mit KI',
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
      title: 'Anmelden mit…',
      signOutLabel: 'Abmelden',
      providers: {
        // V1: Only Google + GitHub are live; re-add Apple/Microsoft when ready.
        google: 'Google',
        github: 'GitHub',
      },
    },
    settingsLabel: 'Einstellungen',
  },
  composer: {
    heading: 'Was ist dein Plan?',
    placeholder: 'Ich plane zurzeit...',
    submitLabel: 'Senden',
    maxCharacters: 1024,
    limitReachedLabel: 'Die maximale Zeichenanzahl ({{max}}) ist erreicht.',
  },
  chat: {
    signedInWith: 'Angemeldet als {{email}}',
    postLogin: {
      alreadySubscribedQuestion:
        'Du stehst auf unserer Warteliste und wir informieren dich gerne, sobald die nächste Version verfügbar ist. :)',
    },
    afterPrompt: {
      subscribedThanks:
        'Immer her damit! 🤩 Die Nachfrage ist gerade ziemlich groß, aber wir bemühen uns um eine zügige Abwicklung. Dein Plan kommt per Mail.',
      unsubscribedThanks:
        'Danke! Wir schicken dir den Plan sobald wie möglich per Mail.',
    },
  },
  newsletter: {
    ctaYesLabel: 'Ja, bitte',
    ctaNoLabel: 'Nein, danke',
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
  machineConfig: {
    heroBadgeLabel: 'Maschinenkonfiguration',
    heading: 'Was soll dein Mac können?',
    placeholder: 'Dev-Tools installieren, MCP-Server hinzufügen, Config anzeigen...',
    cancelLabel: 'Überspringen',
    configuringLabel: 'Konfiguriere…',
  },
  conversationScenarios: {
    anonymousInvite: {
      id: 'anonymousInvite',
      entryStepId: 'invite-intro',
      steps: {
        'invite-intro': {
          id: 'invite-intro',
          role: 'assistant',
          text: 'Melde dich an und wir senden dir deinen Plan sobald wie möglich per Mail zu.',
          stream: defaultStream,
          cta: {
            type: 'oauth_providers',
          },
        },
      },
    },
    postLoginNewsletter: {
      id: 'postLoginNewsletter',
      entryStepId: 'newsletter-question',
      steps: {
        'newsletter-question': {
          id: 'newsletter-question',
          role: 'assistant',
          text: 'Danke für deine Anmeldung! Wir senden dir deinen Plan in den nächsten Tagen per Mail. Möchtest du auch den Newsletter erhalten?',
          stream: defaultStream,
          cta: {
            type: 'newsletter_prompt',
            positiveStepId: 'newsletter-confirm',
            negativeStepId: 'newsletter-decline',
          },
        },
        'newsletter-reconsider': {
          id: 'newsletter-reconsider',
          role: 'assistant',
          text: 'Möchtest du auch die neuesten Updates und Features als Newsletter erhalten?',
          stream: defaultStream,
          cta: {
            type: 'newsletter_prompt',
            positiveStepId: 'newsletter-confirm',
            negativeStepId: 'newsletter-decline',
          },
        },
        'newsletter-confirm': {
          id: 'newsletter-confirm',
          role: 'assistant',
          text: 'Perfekt. Wir melden uns, sobald es Neuigkeiten gibt.',
          stream: defaultStream,
        },
        'newsletter-decline': {
          id: 'newsletter-decline',
          role: 'assistant',
          text: 'Alles klar. Wir senden dir den Plan in Bälde.',
          stream: defaultStream,
        },
      },
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
