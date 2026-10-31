const TAB_NAMES = ['overview', 'messages', 'impersonate', 'pings', 'prompts'] as const;
type TabName = (typeof TAB_NAMES)[number];

const initialized = new Set<TabName>();

function getTabFromPath(): TabName {
  const path = location.pathname.replace(/\/+$/, '');
  const segment = path.split('/').pop() ?? '';
  if (TAB_NAMES.includes(segment as TabName) && segment !== 'dashboard') {
    return segment as TabName;
  }
  return 'overview';
}

function activateTab(tab: TabName) {
  // Update tab buttons
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('border-white/40', isActive);
    btn.classList.toggle('bg-white/10', isActive);
    btn.classList.toggle('border-transparent', !isActive);
  });

  // Show/hide panels
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== `tab-${tab}`);
  });

  // Lazy init
  if (!initialized.has(tab)) {
    initialized.add(tab);
    initTabModule(tab);
  }
}

async function initTabModule(tab: TabName) {
  switch (tab) {
    case 'overview': {
      const { initOverview } = await import('./overview');
      initOverview(document.getElementById('tab-overview')!);
      break;
    }
    case 'messages': {
      const { initMessages } = await import('./app');
      initMessages();
      break;
    }
    case 'impersonate': {
      const { initImpersonate } = await import('./impersonate');
      initImpersonate(document.getElementById('tab-impersonate')!);
      break;
    }
    case 'pings': {
      const { initPings } = await import('./pings');
      initPings(document.getElementById('tab-pings')!);
      break;
    }
    case 'prompts': {
      const { initPrompts } = await import('./prompts');
      initPrompts(document.getElementById('tab-prompts')!);
      break;
    }
  }
}

export function initTabs() {
  const currentTab = getTabFromPath();

  // Bind tab button clicks
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as TabName;
      if (!TAB_NAMES.includes(tab)) return;

      const url = tab === 'overview' ? '/dashboard/' : `/dashboard/${tab}/`;
      history.pushState(null, '', url);
      activateTab(tab);
    });
  });

  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    activateTab(getTabFromPath());
  });

  // Activate initial tab
  activateTab(currentTab);
}
