import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversationIdFromPath, pathForConversation, setConversationPath, useNavigator } from './route';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('conversation URLs', () => {
  it('reads the conversation from /c/<id>', () => {
    expect(conversationIdFromPath(`/c/${ID}`)).toBe(ID);
    expect(conversationIdFromPath(`/c/${ID}/`)).toBe(ID);
    expect(conversationIdFromPath(`/c/${ID.toUpperCase()}`)).toBe(ID);
  });

  it('treats every other path as a new chat', () => {
    expect(conversationIdFromPath('/')).toBeNull();
    expect(conversationIdFromPath('/c/')).toBeNull();
    expect(conversationIdFromPath('/c/not-a-uuid')).toBeNull();
    expect(conversationIdFromPath(`/c/${ID}/extra`)).toBeNull();
    expect(conversationIdFromPath(`/dashboard/c/${ID}`)).toBeNull();
  });

  it('builds the path back', () => {
    expect(pathForConversation(ID)).toBe(`/c/${ID}`);
    expect(pathForConversation(null)).toBe('/');
    expect(conversationIdFromPath(pathForConversation(ID))).toBe(ID);
  });
});

describe('setConversationPath', () => {
  const stubWindow = (pathname: string) => {
    const history = { pushState: vi.fn(), replaceState: vi.fn() };
    vi.stubGlobal('window', { location: { pathname }, history });
    return history;
  };

  afterEach(() => vi.unstubAllGlobals());

  it('pushes or replaces a history entry', () => {
    let history = stubWindow('/');
    setConversationPath(ID, 'push');
    expect(history.pushState).toHaveBeenCalledWith({}, '', `/c/${ID}`);

    history = stubWindow(`/c/${ID}`);
    setConversationPath(null, 'replace');
    expect(history.replaceState).toHaveBeenCalledWith({}, '', '/');
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it('leaves the URL alone when it is already right or asked to', () => {
    let history = stubWindow(`/c/${ID}`);
    setConversationPath(ID, 'push');
    expect(history.pushState).not.toHaveBeenCalled();

    history = stubWindow('/');
    setConversationPath(ID, 'none');
    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('goes through the app\'s router when one is plugged in', () => {
    const history = stubWindow('/');
    const nav = { push: vi.fn(), replace: vi.fn() };
    useNavigator(nav);
    try {
      setConversationPath(ID, 'push');
      setConversationPath(null, 'replace');
    } finally {
      useNavigator(null);
    }
    expect(nav.push).toHaveBeenCalledWith(`/c/${ID}`);
    expect(history.pushState).not.toHaveBeenCalled();
  });
});
