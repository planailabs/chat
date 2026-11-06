export type LocaleKey = 'en' | 'de';

export interface StreamConfig {
  initialDelayMs: number;
  chunkSize: number;
  intervalMs: number;
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
  };
  /** The conversations sidebar. */
  sidebar: {
    open: string;
    close: string;
    newChat: string;
    groups: { today: string; yesterday: string; thisWeek: string; lastWeek: string; thisMonth: string; older: string };
    empty: string;
    rename: string;
    delete: string;
    /** `{{title}}`: the conversation's title. */
    deleteConfirm: string;
    /** A conversation is answering or has news. */
    activity: string;
    applications: string;
    /** Screen readers: the link opens in a new tab. */
    newTab: string;
    search: string;
    /** The search field's keyboard shortcut hint. */
    searchShortcut: string;
    noResults: string;
    /** A hit in the conversation's title. */
    titleMatch: string;
    you: string;
    assistant: string;
  };
  composer: {
    submitLabel: string;
  };
  /** Pages beside the conversation (artifacts, services' views). */
  pages: {
    page: string;
    serviceView: string;
    open: string;
    shown: string;
    close: string;
    fullscreen: string;
    exitFullscreen: string;
    /** "Version {n}" */
    versionLabel: string;
    version: string;
    latest: string;
    loading: string;
    failed: string;
    resize: string;
    confirmTitle: string;
    /** "The page wants to open {url}" */
    openLink: string;
    allow: string;
    deny: string;
  };
  chat: {
    /** The empty chat's heading. */
    heading: string;
    placeholder: string;
    /** Dismisses a question. */
    skipLabel: string;
    /** The composer while a multiple-choice question waits: answering in one's own words. */
    ownAnswerPlaceholder: string;
    /** While the assistant runs a tool. */
    workingLabel: string;
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
      /** The assistant's reason, on the approval card. */
      agentReason: string;
      /** The approval hook's message. */
      hookMessage: string;
      arguments: string;
    };
    tool: {
      /** Before the assistant's reason: "Why: …" */
      why: string;
      /** Before the tool's own name, shown when a run is expanded. */
      call: string;
      safetyCheck: string;
      /** `always`: the call is on the always-ask list. */
      verdicts: { approved: string; rejected: string; failed: string; always: string };
      decisions: { denied: string; asked: string };
      failed: string;
      noReasoning: string;
      showMore: string;
      showLess: string;
    };
    purchase: {
      title: string;
      product: string;
      organization: string;
      price: string;
      /** `{{price}}` with its interval */
      prices: { month: string; year: string; once: string; usage: string; unknown: string };
      /** `{{days}}` */
      trial: string;
      /** `{{price}}`: the price with its interval */
      understand: string;
      buy: string;
      deny: string;
      confirmed: string;
      declined: string;
    };
    errors: {
      rateLimited: string;
      /** `{{plan}}`: the plan's name. */
      planLimited: string;
      tooLong: string;
      unavailable: string;
      readOnly: string;
      signedOut: string;
      generic: string;
      /** A part of the page failed to render. */
      render: string;
    };
  };
  settings: {
    title: string;
    accountTab: string;
    sections: {
      profile: {
        title: string;
        fields: {
          name: string;
          newsletter: string;
        };
      };
      mcp: {
        title: string;
        /** Above the endpoint URL. */
        connect: string;
        purchases: string;
        purchasesHelp: string;
        apps: string;
        noApps: string;
        connected: string;
        lastUsed: string;
        never: string;
        disconnect: string;
        activity: string;
        allowed: string;
        refused: string;
        loadFailed: string;
      };
      connectors: {
        title: string;
        intro: string;
        personal: string;
        /** `{{team}}` */
        team: string;
        configured: string;
        none: string;
        disabled: string;
        loadFailed: string;
        add: string;
        name: string;
        description: string;
        url: string;
        auth: string;
        authBearer: string;
        authOauthPerMember: string;
        authOauthShared: string;
        authNone: string;
        token: string;
        /** Shown in place of the token: `{{hint}}` */
        tokenSet: string;
        newToken: string;
        save: string;
        cancel: string;
        edit: string;
        remove: string;
        connect: string;
        reconnect: string;
        disconnect: string;
        /** `{{service}}`: the assistant's name for it */
        service: string;
        status: { ready: string; connected: string; connect_first: string; needs_reconnect: string };
        sharedByAdmin: string;
        perMember: string;
        shared: string;
        failed: string;
      };
      plan: {
        title: string;
        input: string;
        output: string;
        /** `{{used}}` of `{{limit}}` tokens this hour. */
        usage: string;
        /** No limit: `{{used}}` tokens this hour. */
        usageUnlimited: string;
        unlimited: string;
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
  approval: {
    title: string;
    body: string;
    signedInAs: string;
    signOut: string;
  };
  footer: {
    consent: string;
    termsLabel: string;
    privacyLabel: string;
    termsUrl: string;
    privacyUrl: string;
  };
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
  },
  sidebar: {
    open: 'Show conversations',
    close: 'Hide conversations',
    newChat: 'New chat',
    groups: { today: 'Today', yesterday: 'Yesterday', thisWeek: 'This week', lastWeek: 'Last week', thisMonth: 'This month', older: 'Older' },
    empty: 'No conversations yet.',
    rename: 'Rename',
    delete: 'Delete',
    deleteConfirm: 'Delete “{{title}}”? This can’t be undone.',
    activity: 'New activity',
    applications: 'Applications',
    newTab: 'opens in a new tab',
    search: 'Search chats',
    searchShortcut: 'Ctrl+K',
    noResults: 'No results',
    titleMatch: 'Title',
    you: 'You',
    assistant: 'Assistant',
  },
  composer: {
    submitLabel: 'Send',
  },
  pages: {
    page: 'Page',
    serviceView: 'Service view',
    open: 'Open',
    shown: 'Shown',
    close: 'Close',
    fullscreen: 'Full screen',
    exitFullscreen: 'Exit full screen',
    versionLabel: 'Version {n}',
    version: 'Version',
    latest: 'latest',
    loading: 'Loading…',
    failed: 'The page couldn’t be loaded:',
    resize: 'Resize the page',
    confirmTitle: 'Allow this?',
    openLink: 'The page wants to open this link in a new tab:\n{url}',
    allow: 'Allow',
    deny: 'Deny',
  },
  chat: {
    heading: 'What can we do for you?',
    placeholder: 'Ask about plan.ai, or tell me what your Mac should do…',
    skipLabel: 'Skip',
    ownAnswerPlaceholder: 'Or type your own answer…',
    workingLabel: 'Working…',
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
      agentReason: 'Why the assistant wants this',
      hookMessage: 'Note',
      arguments: 'Arguments',
    },
    tool: {
      why: 'Why:',
      call: 'Tool:',
      safetyCheck: 'Safety check',
      verdicts: { approved: 'approved', rejected: 'rejected', failed: 'couldn’t run', always: 'always asks you' },
      decisions: { denied: 'denied', asked: 'asked you' },
      failed: 'failed',
      noReasoning: 'No reasoning given.',
      showMore: 'Show more',
      showLess: 'Show less',
    },
    purchase: {
      title: 'Confirm purchase',
      product: 'Product',
      organization: 'Organization',
      price: 'Price',
      prices: { month: '{{price}} / month', year: '{{price}} / year', once: '{{price}} once', usage: '{{price}}, billed by usage', unknown: 'Price unknown' },
      trial: 'Free for the first {{days}} days; you can cancel before it’s charged.',
      understand: 'I understand this costs {{price}} and want to buy it.',
      buy: 'Buy',
      deny: 'Don’t buy',
      confirmed: 'Purchase confirmed',
      declined: 'Purchase declined',
    },
    errors: {
      rateLimited: 'You’ve reached the hourly limit of your plan. Please try again later.',
      planLimited: 'You’ve reached the hourly limit of your plan “{{plan}}”. Please try again later.',
      tooLong: 'This message is too long. Please shorten it.',
      unavailable: 'This chat isn’t available for your account.',
      readOnly: 'Read-only while impersonating.',
      signedOut: 'Your session has expired. Please sign in again.',
      generic: 'Something went wrong. Please try again.',
      render: 'This part couldn’t be shown. Reload the page to try again.',
    },
  },
  settings: {
    title: 'Settings',
    accountTab: 'Account',
    sections: {
      profile: {
        title: 'Newsletter & Updates',
        fields: {
          name: 'Your name',
          newsletter: 'Subscribe to newsletter',
        },
      },
      mcp: {
        title: 'Apps (MCP)',
        connect: 'Connect Claude, ChatGPT or another MCP client with this address; it signs in with your plan.ai account:',
        purchases: 'Allow purchases from MCP clients',
        purchasesHelp: 'Each purchase is still shown with its price for you to confirm.',
        apps: 'Connected apps',
        noApps: 'No apps connected.',
        connected: 'connected',
        lastUsed: 'last used',
        never: 'not used yet',
        disconnect: 'Disconnect',
        activity: 'Recent activity',
        allowed: 'allowed',
        refused: 'refused',
        loadFailed: "Couldn't load your connected apps.",
      },
      connectors: {
        title: 'Connectors',
        intro: 'MCP servers the assistant may use for you. Team connectors work for every member; only team admins change them.',
        personal: 'Yours',
        team: 'Team {{team}}',
        configured: 'From plan.ai',
        none: 'No connectors yet.',
        disabled: "Connectors aren't available on this server.",
        loadFailed: "Couldn't load your connectors.",
        add: 'Add connector',
        name: 'Name',
        description: 'What it is for (optional)',
        url: 'MCP server URL (https)',
        auth: 'Authentication',
        authBearer: 'Bearer token',
        authOauthPerMember: 'OAuth, each member connects their own account',
        authOauthShared: 'OAuth, one connection for the team',
        authNone: 'None',
        token: 'Token',
        tokenSet: 'token {{hint}}',
        newToken: 'New token (leave empty to keep it)',
        save: 'Save',
        cancel: 'Cancel',
        edit: 'Edit',
        remove: 'Remove',
        connect: 'Connect',
        reconnect: 'Reconnect',
        disconnect: 'Disconnect',
        service: 'The assistant calls it {{service}}',
        status: { ready: 'ready', connected: 'connected', connect_first: 'connect first', needs_reconnect: 'needs reconnecting' },
        sharedByAdmin: 'A team admin connects it.',
        perMember: 'each member connects',
        shared: 'shared',
        failed: "That didn't work: {{message}}",
      },
      plan: {
        title: 'Plan',
        input: 'Input',
        output: 'Output',
        usage: '{{used}} of {{limit}} tokens this hour',
        usageUnlimited: '{{used}} tokens this hour',
        unlimited: 'unlimited',
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
  approval: {
    title: 'Your account needs to be approved',
    body: 'Thanks for signing up. An admin has to approve your account before you can chat. You can come back here once it has been approved.',
    signedInAs: 'Signed in as',
    signOut: 'Sign out',
  },
  footer: {
    consent:
      'By using this service, you agree to our Terms&nbsp;and&nbsp;Privacy&nbsp;Policy.',
    termsLabel: 'Terms',
    privacyLabel: 'Privacy&nbsp;Policy',
    termsUrl: '/legal-en.md',
    privacyUrl: '/legal-en.md',
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
  },
  sidebar: {
    open: 'Gespräche anzeigen',
    close: 'Gespräche ausblenden',
    newChat: 'Neuer Chat',
    groups: { today: 'Heute', yesterday: 'Gestern', thisWeek: 'Diese Woche', lastWeek: 'Letzte Woche', thisMonth: 'Diesen Monat', older: 'Älter' },
    empty: 'Noch keine Gespräche.',
    rename: 'Umbenennen',
    delete: 'Löschen',
    deleteConfirm: '„{{title}}“ löschen? Das kann nicht rückgängig gemacht werden.',
    activity: 'Neue Aktivität',
    applications: 'Anwendungen',
    newTab: 'öffnet in einem neuen Tab',
    search: 'Chats durchsuchen',
    searchShortcut: 'Strg+K',
    noResults: 'Keine Treffer',
    titleMatch: 'Titel',
    you: 'Du',
    assistant: 'Assistent',
  },
  composer: {
    submitLabel: 'Senden',
  },
  pages: {
    page: 'Seite',
    serviceView: 'Ansicht des Dienstes',
    open: 'Öffnen',
    shown: 'Angezeigt',
    close: 'Schließen',
    fullscreen: 'Vollbild',
    exitFullscreen: 'Vollbild beenden',
    versionLabel: 'Version {n}',
    version: 'Version',
    latest: 'aktuell',
    loading: 'Wird geladen…',
    failed: 'Die Seite konnte nicht geladen werden:',
    resize: 'Seitenbreite ändern',
    confirmTitle: 'Erlauben?',
    openLink: 'Die Seite möchte diesen Link in einem neuen Tab öffnen:\n{url}',
    allow: 'Erlauben',
    deny: 'Ablehnen',
  },
  chat: {
    heading: 'Was können wir für dich tun?',
    placeholder: 'Frag nach plan.ai oder sag mir, was dein Mac können soll…',
    skipLabel: 'Überspringen',
    ownAnswerPlaceholder: 'Oder schreib deine eigene Antwort…',
    workingLabel: 'Arbeite…',
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
      agentReason: 'Warum der Assistent das möchte',
      hookMessage: 'Hinweis',
      arguments: 'Argumente',
    },
    tool: {
      why: 'Warum:',
      call: 'Werkzeug:',
      safetyCheck: 'Sicherheitsprüfung',
      verdicts: { approved: 'bestanden', rejected: 'abgelehnt', failed: 'nicht möglich', always: 'fragt immer dich' },
      decisions: { denied: 'blockiert', asked: 'bei dir nachgefragt' },
      failed: 'fehlgeschlagen',
      noReasoning: 'Keine Begründung angegeben.',
      showMore: 'Mehr anzeigen',
      showLess: 'Weniger anzeigen',
    },
    purchase: {
      title: 'Kauf bestätigen',
      product: 'Produkt',
      organization: 'Organisation',
      price: 'Preis',
      prices: { month: '{{price}} / Monat', year: '{{price}} / Jahr', once: '{{price}} einmalig', usage: '{{price}}, nach Nutzung abgerechnet', unknown: 'Preis unbekannt' },
      trial: 'Die ersten {{days}} Tage kostenlos; du kannst vorher kündigen.',
      understand: 'Mir ist klar, dass das {{price}} kostet, und ich möchte es kaufen.',
      buy: 'Kaufen',
      deny: 'Nicht kaufen',
      confirmed: 'Kauf bestätigt',
      declined: 'Kauf abgelehnt',
    },
    errors: {
      rateLimited: 'Du hast das Stundenlimit deines Tarifs erreicht. Bitte versuche es später noch einmal.',
      planLimited: 'Du hast das Stundenlimit deines Tarifs „{{plan}}“ erreicht. Bitte versuche es später noch einmal.',
      tooLong: 'Diese Nachricht ist zu lang. Bitte kürze sie.',
      unavailable: 'Dieser Chat ist für dein Konto nicht verfügbar.',
      readOnly: 'Beim Impersonieren ist nur Lesen möglich.',
      signedOut: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
      generic: 'Etwas ist schiefgelaufen. Bitte versuche es noch einmal.',
      render: 'Dieser Teil konnte nicht angezeigt werden. Lade die Seite neu, um es noch einmal zu versuchen.',
    },
  },
  settings: {
    title: 'Einstellungen',
    accountTab: 'Konto',
    sections: {
      profile: {
        title: 'Profil',
        fields: {
          name: 'Dein Name',
          newsletter: 'Newsletter abonnieren',
        },
      },
      mcp: {
        title: 'Apps (MCP)',
        connect: 'Verbinde Claude, ChatGPT oder einen anderen MCP-Client mit dieser Adresse; die Anmeldung läuft über dein plan.ai-Konto:',
        purchases: 'Käufe aus MCP-Clients erlauben',
        purchasesHelp: 'Jeder Kauf wird dir weiterhin mit seinem Preis zur Bestätigung angezeigt.',
        apps: 'Verbundene Apps',
        noApps: 'Keine Apps verbunden.',
        connected: 'verbunden',
        lastUsed: 'zuletzt genutzt',
        never: 'noch nicht genutzt',
        disconnect: 'Trennen',
        activity: 'Letzte Aktivität',
        allowed: 'erlaubt',
        refused: 'abgelehnt',
        loadFailed: 'Deine verbundenen Apps konnten nicht geladen werden.',
      },
      connectors: {
        title: 'Konnektoren',
        intro: 'MCP-Server, die der Assistent für dich nutzen darf. Team-Konnektoren gelten für alle Mitglieder; ändern können sie nur Team-Admins.',
        personal: 'Deine',
        team: 'Team {{team}}',
        configured: 'Von plan.ai',
        none: 'Noch keine Konnektoren.',
        disabled: 'Konnektoren sind auf diesem Server nicht verfügbar.',
        loadFailed: 'Deine Konnektoren konnten nicht geladen werden.',
        add: 'Konnektor hinzufügen',
        name: 'Name',
        description: 'Wofür er ist (optional)',
        url: 'URL des MCP-Servers (https)',
        auth: 'Anmeldung',
        authBearer: 'Bearer-Token',
        authOauthPerMember: 'OAuth, jedes Mitglied verbindet sein eigenes Konto',
        authOauthShared: 'OAuth, eine Verbindung für das Team',
        authNone: 'Keine',
        token: 'Token',
        tokenSet: 'Token {{hint}}',
        newToken: 'Neues Token (leer lassen, um es zu behalten)',
        save: 'Speichern',
        cancel: 'Abbrechen',
        edit: 'Bearbeiten',
        remove: 'Entfernen',
        connect: 'Verbinden',
        reconnect: 'Neu verbinden',
        disconnect: 'Trennen',
        service: 'Der Assistent nennt ihn {{service}}',
        status: { ready: 'bereit', connected: 'verbunden', connect_first: 'erst verbinden', needs_reconnect: 'neu verbinden' },
        sharedByAdmin: 'Ein Team-Admin verbindet ihn.',
        perMember: 'jedes Mitglied verbindet',
        shared: 'geteilt',
        failed: 'Das hat nicht geklappt: {{message}}',
      },
      plan: {
        title: 'Tarif',
        input: 'Eingabe',
        output: 'Ausgabe',
        usage: '{{used}} von {{limit}} Tokens in dieser Stunde',
        usageUnlimited: '{{used}} Tokens in dieser Stunde',
        unlimited: 'unbegrenzt',
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
  approval: {
    title: 'Dein Konto muss noch freigegeben werden',
    body: 'Danke für deine Anmeldung. Ein Admin muss dein Konto freigeben, bevor du chatten kannst. Schau wieder vorbei, sobald es freigegeben ist.',
    signedInAs: 'Angemeldet als',
    signOut: 'Abmelden',
  },
  footer: {
    consent:
      'Durch die Nutzung stimmst du unseren Nutzungsbedingungen und Datenschutzrichtlinien&nbsp;zu.',
    termsLabel: 'Nutzungsbedingungen',
    privacyLabel: 'Datenschutzrichtlinien',
    termsUrl: '/legal-de.md',
    privacyUrl: '/legal-de.md',
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
